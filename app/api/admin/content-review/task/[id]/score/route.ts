import { NextResponse } from "next/server";
import {
  getBatchById,
  getCriterion,
  getTaskById,
  recomputeBatch,
  upsertScore,
} from "@/lib/repositories/content-review";

/**
 * Grades one cell (task x criterion) on the 0–10 scale and returns the batch it
 * belongs to, already recomputed — the totals panel updates from the response
 * rather than from a second round trip, so what the reviewer sees is always what
 * was actually stored.
 *
 * A null or empty score clears the cell instead of storing 0. The two are
 * different claims: 0 says the work failed this criterion, empty says nobody has
 * looked yet, and only the first one should cost the member anything.
 *
 * The criterion has to belong to the same member as the batch. Migration 008
 * deliberately leaves that rule out of the schema — enforcing it there would
 * mean a trigger joining three tables on every grade — so it is enforced here,
 * the one place a grade can be created.
 */
export async function PUT(req: Request, ctx: RouteContext<"/api/admin/content-review/task/[id]/score">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const task = await getTaskById(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const criteriaId = String(body.criteriaId ?? "").trim();
  if (!criteriaId) {
    return NextResponse.json({ error: "criteriaId is required" }, { status: 400 });
  }

  const [criterion, batch] = await Promise.all([getCriterion(criteriaId), getBatchById(task.batch_id)]);
  if (!criterion) {
    return NextResponse.json({ error: "Criterion not found" }, { status: 404 });
  }
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  if (criterion.member_name !== batch.member_name) {
    return NextResponse.json(
      {
        error: `"${criterion.name}" belongs to ${criterion.member_name}'s checklist, not ${batch.member_name}'s. Grade this month against ${batch.member_name}'s own criteria.`,
      },
      { status: 400 },
    );
  }

  let score: number | null = null;
  if (body.score !== undefined && body.score !== null && body.score !== "") {
    score = Number(body.score);
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      return NextResponse.json({ error: "score must be between 0 and 10" }, { status: 400 });
    }
  }

  await upsertScore(id, criteriaId, score);
  const recomputed = await recomputeBatch(task.batch_id);

  return NextResponse.json({ ok: true, taskId: id, criteriaId, score, batch: recomputed });
}
