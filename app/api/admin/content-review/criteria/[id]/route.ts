import { NextResponse } from "next/server";
import {
  countScoresForCriterion,
  deleteCriterion,
  getCriterion,
  listBatchIdsScoredWithCriterion,
  recomputeBatch,
  updateCriterion,
  type CriterionPatch,
} from "@/lib/repositories/content-review";

// Next 16 hands route handlers `params` as a promise — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
export async function PATCH(_req: Request, ctx: RouteContext<"/api/admin/content-review/criteria/[id]">) {
  const { id } = await ctx.params;
  const body = (await _req.json().catch(() => ({}))) as Record<string, unknown>;

  const existing = await getCriterion(id);
  if (!existing) {
    return NextResponse.json({ error: "Criterion not found" }, { status: 404 });
  }

  const patch: CriterionPatch = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: "name must not be empty" }, { status: 400 });
    patch.name = name;
  }

  if (body.weight !== undefined) {
    const weight = Number(body.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      return NextResponse.json({ error: "weight must be greater than 0" }, { status: 400 });
    }
    patch.weight = weight;
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive must be true or false" }, { status: 400 });
    }
    patch.isActive = body.isActive;
  }

  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder);
    if (!Number.isInteger(sortOrder)) {
      return NextResponse.json({ error: "sortOrder must be a whole number" }, { status: 400 });
    }
    patch.sortOrder = sortOrder;
  }

  const criterion = await updateCriterion(id, patch);

  // A weight is part of the arithmetic behind every cached quality figure, so
  // changing it makes those figures wrong until they are rebuilt. Deactivating
  // is not the same: an already-graded cell keeps counting either way, so the
  // numbers stand.
  let recomputedBatches = 0;
  if (patch.weight !== undefined && patch.weight !== Number(existing.weight)) {
    const batchIds = await listBatchIdsScoredWithCriterion(id);
    for (const batchId of batchIds) {
      await recomputeBatch(batchId);
    }
    recomputedBatches = batchIds.length;
  }

  return NextResponse.json({ criterion, recomputedBatches });
}

/**
 * Deleting a criterion cascades away every grade ever given under it, so by
 * default this refuses and points at deactivation, which keeps the history and
 * only hides the column from new reviews. `?force=true` is the escape hatch the
 * UI puts behind an explicit confirmation.
 */
export async function DELETE(req: Request, ctx: RouteContext<"/api/admin/content-review/criteria/[id]">) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "true";

  const existing = await getCriterion(id);
  if (!existing) {
    return NextResponse.json({ error: "Criterion not found" }, { status: 404 });
  }

  const scoreCount = await countScoresForCriterion(id);

  if (scoreCount > 0 && !force) {
    return NextResponse.json(
      {
        error: `"${existing.name}" has already been used to grade ${scoreCount} cells. Deactivate it instead — that hides it from new reviews and keeps past months intact.`,
        scoreCount,
        canForce: true,
      },
      { status: 409 },
    );
  }

  // Which batches lose a grade has to be known before the rows are gone.
  const affectedBatchIds = scoreCount > 0 ? await listBatchIdsScoredWithCriterion(id) : [];

  await deleteCriterion(id);

  for (const batchId of affectedBatchIds) {
    await recomputeBatch(batchId);
  }

  return NextResponse.json({ ok: true, deletedScoreCount: scoreCount, recomputedBatches: affectedBatchIds.length });
}
