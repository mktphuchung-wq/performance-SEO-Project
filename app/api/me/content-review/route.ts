import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { currentMonthStart, previousMonthStart } from "@/lib/content-review/month";
import { getMemberNameByEmail } from "@/lib/repositories/member-aliases";
import { getContentKpiForMember, listBatchesByMember } from "@/lib/repositories/content-review";

/**
 * A member reading their own Content KPI: the two calendar months, the rolling
 * three-month average, and every month on record.
 *
 * /api/me is only gated on being signed in, so ownership is checked here — the
 * session email is resolved to a Sheet name and only that name is queried. There
 * is deliberately no "admin views another member" branch: admins have the full
 * review screen, and leaving the branch out means this route can never serve one
 * person another person's data.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memberName = await getMemberNameByEmail(session.user.email);

  const thisMonthStart = currentMonthStart();
  const previousMonth = previousMonthStart();

  // No mapping is not an error — it means nobody has reviewed work under this
  // account yet. Empty everything says that without inventing a zero.
  if (!memberName) {
    return NextResponse.json({
      memberName: null,
      thisMonth: null,
      previousMonth: null,
      threeMonthAvg: null,
      scoredMonthCount: 0,
      history: [],
    });
  }

  const [summary, history] = await Promise.all([
    getContentKpiForMember(memberName, thisMonthStart, previousMonth),
    listBatchesByMember(memberName),
  ]);

  return NextResponse.json({
    memberName,
    thisMonth: summary.thisMonth,
    previousMonth: summary.previousMonth,
    threeMonthAvg: summary.threeMonthAvg,
    threeMonthMonths: summary.threeMonthMonths,
    scoredMonthCount: summary.scoredMonthCount,
    monthLabels: { thisMonth: thisMonthStart, previousMonth },
    history,
  });
}
