"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { StatCard } from "@/components/StatCard";
import { SyncRefreshPanel } from "@/components/SyncRefreshPanel";
import { DataQualityPanel } from "@/components/DataQualityPanel";
import { RunHistoryPanel } from "@/components/RunHistoryPanel";
import { MetricDeltaInline } from "@/components/MetricDelta";
import { PageHeader } from "@/components/ui";
import { RANGE_LABELS, formatCtr, formatNumber } from "@/lib/format";
import { aggregateRollups } from "@/lib/performance/aggregate";
import { DEFAULT_RANGE_KEY } from "@/lib/ranges";
import type { MemberRollupRow, ProjectRollupRow } from "@/lib/repositories/rollups";

export default function AdminOverviewPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [members, setMembers] = useState<MemberRollupRow[]>([]);
  const [projects, setProjects] = useState<ProjectRollupRow[]>([]);
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
