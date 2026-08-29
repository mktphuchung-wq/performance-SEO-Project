import { NextResponse } from "next/server";
import {
  getBatchById,
  listScoresByBatch,
  listTasksByBatch,
  recomputeBatch,
  syncTasksFromWorks,
} from "@/lib/repositories/content-review";

/**
 * Pulls this month's work events into the batch on demand.
 *
 * Loading the month already does this, so the button exists for the one case
 * loading does not cover: the reviewer has the screen open and a Sheet sync has
 * just run behind them. It is the same idempotent generator, so pressing it
 * twice changes nothing.
 *
 * A final month refuses rather than silently doing nothing — its score is
 * published, and the reviewer has to reopen it as a draft to accept new work.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/admin/content-review/batch/[id]/sync">) {
  const { id } = await ctx.params;

  const batch = await getBatchById(id);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }
  if (batch.status === "final") {
    return NextResponse.json(
      { error: "This month is marked final. Reopen it as a draft to pull in new work." },
      { status: 409 },
    );
  }

  const { written, removed } = await syncTasksFromWorks(id, batch.member_name, batch.month);
  const updated = (await recomputeBatch(id)) ?? batch;
  const [tasks, scores] = await Promise.all([listTasksByBatch(id), listScoresByBatch(id)]);

  return NextResponse.json({ written, removed, batch: updated, tasks, scores });
}
