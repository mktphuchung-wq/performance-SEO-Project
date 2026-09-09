import { runJson } from "@/lib/api/route-response";
import { averageOfficialKpi, buildMemberCompositeKpis } from "@/lib/performance/composite-score";
import { getCompositeKpiSettings } from "@/lib/repositories/kpi-settings";
import { listMemberCompositeScoreInputs } from "@/lib/repositories/kpi-score-rollups";
import { getMemberKpiWeightsMap } from "@/lib/repositories/member-kpi-weights";

export async function GET() {
  return runJson("GET /api/admin/kpi/members/summary", async () => {
    const [inputs, settings, weightsByMember] = await Promise.all([
      listMemberCompositeScoreInputs(),
      getCompositeKpiSettings(),
      getMemberKpiWeightsMap(),
    ]);
    const rows = buildMemberCompositeKpis(inputs, {
      defaultWeights: settings.defaultWeights,
      tolerance: settings.trendTolerance,
      weightsByMember,
    }).sort((a, b) => {
      if (a.officialKpi === null && b.officialKpi === null) return a.memberName.localeCompare(b.memberName);
      if (a.officialKpi === null) return 1;
      if (b.officialKpi === null) return -1;
      return b.officialKpi - a.officialKpi || a.memberName.localeCompare(b.memberName);
    });
    return {
      rows,
      avgOfficialKpi: averageOfficialKpi(rows),
      scoredMemberCount: rows.filter((row) => row.officialKpi !== null).length,
      memberCount: rows.length,
      defaultWeights: settings.defaultWeights,
      trendTolerance: settings.trendTolerance,
    };
  });
}
