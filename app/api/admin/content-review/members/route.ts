import { NextResponse } from "next/server";
import { listReviewableMemberNames } from "@/lib/content-review/members";
import { countCriteriaByMember, listMembersWithCriteria } from "@/lib/repositories/content-review";

/**
 * Names for the member pickers, plus who already has a checklist.
 *
 * The counts are what lets the settings page tell a member who is set up from
 * one who has never been configured — the difference between "0 criteria" and
 * "not set up yet" is the whole reason the copy button exists.
 */
export async function GET() {
  const [memberNames, withCriteria, counts] = await Promise.all([
    listReviewableMemberNames(),
    listMembersWithCriteria(),
    countCriteriaByMember(),
  ]);

  return NextResponse.json({
    memberNames,
    membersWithCriteria: withCriteria,
    activeCriteriaCounts: Object.fromEntries(counts),
  });
}
