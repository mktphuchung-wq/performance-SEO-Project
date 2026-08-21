"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { StatCard } from "@/components/StatCard";
import { SyncRefreshPanel } from "@/components/SyncRefreshPanel";
import { DataQualityPanel } from "@/components/DataQualityPanel";
import { RunHistoryPanel } from "@/components/RunHistoryPanel";
import { MetricDeltaInline } from "@/components/MetricDelta";
import { PageHeader } from "@/components/ui";
import { RANGE_LABELS, formatCtr, formatNumber, formatOfficialKpi } from "@/lib/format";
import { aggregateRollups } from "@/lib/performance/aggregate";
import { DEFAULT_RANGE_KEY } from "@/lib/ranges";
import type { MemberRollupRow, ProjectRollupRow } from "@/lib/repositories/rollups";

interface TeamKpiSummary {
  avgOfficialKpi: number | null;
  scoredMemberCount: number;
  memberCount: number;
}

const EMPTY_KPI: TeamKpiSummary = { avgOfficialKpi: null, scoredMemberCount: 0, memberCount: 0 };

export default function AdminOverviewPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [members, setMembers] = useState<MemberRollupRow[]>([]);
  const [projects, setProjects] = useState<ProjectRollupRow[]>([]);
  const [kpi, setKpi] = useState<TeamKpiSummary>(EMPTY_KPI);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/members?range=${range}`).then((r) => r.json()),
      fetch(`/api/admin/projects?range=${range}`).then((r) => r.json()),
    ]).then(([membersRes, projectsRes]) => {
      setMembers(membersRes.rows ?? []);
      setProjects(projectsRes.rows ?? []);
    });
  }, [range, dataVersion]);

  // Avg Official KPI is built from 1M + 3M + 6M together, so it does not follow
  // the RangeSwitcher — only a data refresh can move it. Members with no score
  // are excluded from the average by the API rather than counted as 0, which
  // would drag the team down for work that is not measurable yet.
  useEffect(() => {
    fetch("/api/admin/kpi/members/summary")
      .then((r) => r.json())
      .catch(() => EMPTY_KPI)
      .then((res: Partial<TeamKpiSummary>) =>
        setKpi({
          avgOfficialKpi: res.avgOfficialKpi ?? null,
          scoredMemberCount: res.scoredMemberCount ?? 0,
          memberCount: res.memberCount ?? 0,
        }),
      );
  }, [dataVersion]);

  // Members partition every URL, so their rollups sum to the team total.
  const totals = aggregateRollups(members);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader
        title="Team overview"
        description={`Aggregated across all members and projects — ${RANGE_LABELS[range] ?? range}.`}
        action={<RangeSwitcher value={range} onChange={setRange} />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <StatCard
          label="Avg Official KPI"
          value={formatOfficialKpi(kpi.avgOfficialKpi)}
          sub={`${kpi.scoredMemberCount} of ${kpi.memberCount} members scored · not affected by the range`}
        />
        <StatCard
          label="Clicks"
          value={formatNumber(totals.clicks)}
          sub={
            <MetricDeltaInline
              delta={totals.clickDelta}
              pct={totals.clickGrowthPct}
              previous={totals.previousClicks}
            />
          }
        />
        <StatCard
          label="Impressions"
          value={formatNumber(totals.impressions)}
          sub={
            <MetricDeltaInline
              delta={totals.impressionDelta}
              pct={totals.impressionGrowthPct}
              previous={totals.previousImpressions}
            />
          }
        />
        <StatCard label="CTR" value={formatCtr(totals.ctr)} sub="clicks ÷ impressions" />
        <StatCard
          label="Growing / Declining"
          value={`${totals.growing} / ${totals.declining}`}
          sub={`${formatNumber(totals.noData)} URLs without data`}
        />
        <StatCard
          label="URLs"
          value={formatNumber(totals.urls)}
          sub={`${formatNumber(totals.withData)} with data`}
        />
        <StatCard label="Members" value={String(members.length)} />
        <StatCard label="Projects" value={String(projects.length)} />
      </div>

      <SyncRefreshPanel onDone={() => setDataVersion((v) => v + 1)} />
      <DataQualityPanel refreshKey={dataVersion} />
      <RunHistoryPanel refreshKey={dataVersion} />
    </div>
  );
}
