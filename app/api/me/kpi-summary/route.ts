import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { buildMemberCompositeKpi } from "@/lib/performance/composite-score";
import { getCompositeKpiSettings } from "@/lib/repositories/kpi-settings";
import { getMemberCompositeScoreInputsByEmail } from "@/lib/repositories/kpi-score-rollups";
import { getMemberKpiWeightsMap } from "@/lib/repositories/member-kpi-weights";

/**
 * The signed-in member's Official KPI.
 *
 * Deliberately takes no `?range=`: the KPI is derived from 1M + 3M + 6M
 * together, so the range the dashboard is investigating in cannot change it.
 * That independence is the whole point of the number — pick "All time" in the
 * switcher and this still answers "what is my KPI".
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [input, settings, weightsByMember] = await Promise.all([
    getMemberCompositeScoreInputsByEmail(session.user.email),
    getCompositeKpiSettings(),
    getMemberKpiWeightsMap(),
  ]);

  if (!input) {
    // No scored period at all. Null, not zero — nothing has been measured yet.
    return NextResponse.json({ summary: null });
  }

  const summary = buildMemberCompositeKpi(
    {
      memberName: input.memberName,
      memberEmail: input.memberEmail,
      score1m: input.score1m,
      score3m: input.score3m,
      score6m: input.score6m,
    },
    { defaultWeights: settings.defaultWeights, tolerance: settings.trendTolerance, weightsByMember },
  );

  return NextResponse.json({ summary, refreshedAt: input.refreshedAt });
}
