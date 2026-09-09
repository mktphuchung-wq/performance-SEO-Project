import { getServerSession } from "next-auth/next";
import { ApiRouteError, runJson } from "@/lib/api/route-response";
import { authOptions } from "@/lib/auth";
import { currentMonthStart, previousMonthStart } from "@/lib/content-review/month";
import { getMemberNameByEmail } from "@/lib/repositories/member-aliases";
import { getContentKpiForMember, listBatchesByMember } from "@/lib/repositories/content-review";

export async function GET() {
  return runJson("GET /api/me/content-review", async () => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) throw new ApiRouteError(401, "UNAUTHORIZED", "Please sign in to continue.");
    const memberName = await getMemberNameByEmail(session.user.email);
    const thisMonthStart = currentMonthStart();
    const previousMonth = previousMonthStart();
    if (!memberName) return { memberName: null, thisMonth: null, previousMonth: null, threeMonthAvg: null, scoredMonthCount: 0, history: [] };
    const [summary, history] = await Promise.all([
      getContentKpiForMember(memberName, thisMonthStart, previousMonth),
      listBatchesByMember(memberName),
    ]);
    return {
      memberName,
      thisMonth: summary.thisMonth,
      previousMonth: summary.previousMonth,
      threeMonthAvg: summary.threeMonthAvg,
      threeMonthMonths: summary.threeMonthMonths,
      scoredMonthCount: summary.scoredMonthCount,
      monthLabels: { thisMonth: thisMonthStart, previousMonth },
      history,
    };
  });
}
