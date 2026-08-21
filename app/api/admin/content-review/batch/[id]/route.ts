import { NextResponse } from "next/server";
import {
  getBatchById,
  recomputeBatch,
  updateBatchSettings,
  type ContentReviewStatus,
} from "@/lib/repositories/content-review";

const STATUSES: ContentReviewStatus[] = ["draft", "final"];

/**
 * Edits the two things about a batch that are not derived: the monthly target
 * and the draft/final label.
 *
 * "Final" is a label, not a lock — only admins can reach any of these routes at
 * all, so the risk it would guard against does not exist, and a month that turns
 * out to be graded wrong should stay fixable. Making it a real lock is one
 * condition here, with no schema change.
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/content-review/batch/[id]">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const batch = await getBatchById(id);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const patch: { minPost?: number; status?: ContentReviewStatus } = {};

  if (body.minPost !== undefined && body.minPost !== null && body.minPost !== "") {
    const minPost = Number(body.minPost);
    if (!Number.isInteger(minPost) || minPost < 0) {
      return NextResponse.json({ error: "minPost must be a whole number, 0 or more" }, { status: 400 });
    }
    patch.minPost = minPost;
  }

  if (body.status !== undefined) {
    const status = String(body.status) as ContentReviewStatus;
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
    }
    patch.status = status;
  }

  await updateBatchSettings(id, patch);

  // min_post is the denominator of completion, so the cached score is stale the
  // moment it changes.
  const updated = patch.minPost !== undefined ? await recomputeBatch(id) : await getBatchById(id);
  return NextResponse.json({ batch: updated });
}
