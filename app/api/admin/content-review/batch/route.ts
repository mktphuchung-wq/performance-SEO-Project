import { NextResponse } from "next/server";
import { normalizeMonth } from "@/lib/content-review/month";
import {
  getOrCreateBatch,
  listBatchesByMember,
  listCriteria,
  listScoresByBatch,
  listTasksByBatch,
} from "@/lib/repositories/content-review";

/**
 * Everything the review screen needs for one (member, month): the batch, that
 * member's own checklist, the pasted tasks and every grade given so far.
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

  const batch = await getOrCreateBatch(memberName, month);
  const [criteria, tasks, scores, history] = await Promise.all([
    listCriteria(memberName),
    listTasksByBatch(batch.id),
    listScoresByBatch(batch.id),
    listBatchesByMember(memberName),
  ]);

  return NextResponse.json({ batch, criteria, tasks, scores, history });
}
