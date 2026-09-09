import { getServerSession } from "next-auth/next";
import { ApiRouteError, runJson } from "@/lib/api/route-response";
import { authOptions } from "@/lib/auth";
import { buildMemberCompositeKpi } from "@/lib/performance/composite-score";
import { getCompositeKpiSettings } from "@/lib/repositories/kpi-settings";
import { getMemberCompositeScoreInputsByEmail } from "@/lib/repositories/kpi-score-rollups";
import { getMemberKpiWeightsMap } from "@/lib/repositories/member-kpi-weights";

export async function GET() {
  return runJson("GET /api/me/kpi-summary", async () => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) throw new ApiRouteError(401, "UNAUTHORIZED", "Please sign in to continue.");
    const [input, settings, weightsByMember] = await Promise.all([
      getMemberCompositeScoreInputsByEmail(session.user.email),
      getCompositeKpiSettings(),
      getMemberKpiWeightsMap(),
    ]);
    if (!input) return { summary: null };
    const summary = buildMemberCompositeKpi(
      { memberName: input.memberName, memberEmail: input.memberEmail, score1m: input.score1m, score3m: input.score3m, score6m: input.score6m },
      { defaultWeights: settings.defaultWeights, tolerance: settings.trendTolerance, weightsByMember },
    );
    return { summary, refreshedAt: input.refreshedAt };
  });
}
