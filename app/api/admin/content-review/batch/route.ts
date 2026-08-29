import { NextResponse } from "next/server";
import { normalizeMonth } from "@/lib/content-review/month";
import {
  getOrCreateBatch,
  listBatchesByMember,
  listCriteria,
  listScoresByBatch,
  listTasksByBatch,
  recomputeBatch,
  syncTasksFromWorks,
} from "@/lib/repositories/content-review";

/**
 * Everything the review screen needs for one (member, month): the batch, that
 * member's own checklist, the tasks and every grade given so far.
 *
 * Tasks are generated from the work events the Sheet sync already stored, right
 * here on load, so opening a month is all it takes to see what that person did
 * in it — there is nothing to paste. The generator is idempotent, so loading the
 * same month repeatedly cannot duplicate a row (see syncTasksFromWorks).
 *
 * A month marked final is left alone: its score has been published, and quietly
 * adding work to it afterwards would move a number someone already reported.
 * Reopening it as a draft is what asks for the new work.
 *
 * The checklist is fetched for the batch's member, not for the team — since
 * migration 008 the columns of the grid are personal, so a month opened under
 * one name can never be graded on another name's criteria.
 *
 * All of that member's criteria are returned, active or not: a month graded
 * before a criterion was retired still has to render the column it was graded on.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const memberName = (searchParams.get("member") ?? "").trim();
  if (!memberName) {
    return NextResponse.json({ error: "member is required" }, { status: 400 });
  }

  const month = normalizeMonth(searchParams.get("month"));
  if (!month) {
    return NextResponse.json({ error: "month is required, as YYYY-MM" }, { status: 400 });
  }

  let batch = await getOrCreateBatch(memberName, month);
  if (batch.status !== "final") {
    const { written, removed } = await syncTasksFromWorks(batch.id, memberName, month);
    if (written > 0 || removed > 0) batch = (await recomputeBatch(batch.id)) ?? batch;
  }

  const [criteria, tasks, scores, history] = await Promise.all([
    listCriteria(memberName),
    listTasksByBatch(batch.id),
    listScoresByBatch(batch.id),
    listBatchesByMember(memberName),
  ]);

  return NextResponse.json({ batch, criteria, tasks, scores, history });
}
