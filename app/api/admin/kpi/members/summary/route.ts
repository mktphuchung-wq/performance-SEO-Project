import { NextResponse } from "next/server";
import { averageOfficialKpi, buildMemberCompositeKpis } from "@/lib/performance/composite-score";
import { getCompositeKpiSettings } from "@/lib/repositories/kpi-settings";
import { listMemberCompositeScoreInputs } from "@/lib/repositories/kpi-score-rollups";
import { getMemberKpiWeightsMap } from "@/lib/repositories/member-kpi-weights";

/**
 * Official KPI for every member, ranked. Like the member route, it takes no
 * range — the admin RangeSwitcher investigates traffic, it does not redefine the
 * KPI.
 *
 * `avgOfficialKpi` is computed here rather than in the client so the rule that
 * a null member is excluded (not counted as 0) lives in one place.
 */
export async function GET() {
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
    // Official KPI descending, nulls always last whichever way it is read.
    if (a.officialKpi === null && b.officialKpi === null) return a.memberName.localeCompare(b.memberName);
    if (a.officialKpi === null) return 1;
    if (b.officialKpi === null) return -1;
    return b.officialKpi - a.officialKpi || a.memberName.localeCompare(b.memberName);
  });

  return NextResponse.json({
    rows,
    avgOfficialKpi: averageOfficialKpi(rows),
    scoredMemberCount: rows.filter((row) => row.officialKpi !== null).length,
    memberCount: rows.length,
    defaultWeights: settings.defaultWeights,
    trendTolerance: settings.trendTolerance,
  });
}
