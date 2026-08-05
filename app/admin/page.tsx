"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { StatCard } from "@/components/StatCard";
import { SyncRefreshPanel } from "@/components/SyncRefreshPanel";
import { DataQualityPanel } from "@/components/DataQualityPanel";
import { RunHistoryPanel } from "@/components/RunHistoryPanel";
import { PageHeader } from "@/components/ui";
import { RANGE_LABELS, formatNumber } from "@/lib/format";
import type { MemberRollupRow, ProjectRollupRow } from "@/lib/repositories/rollups";

export default function AdminOverviewPage() {
  const [range, setRange] = useState("current_month");
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

  const totals = members.reduce(
    (acc, m) => ({
      clicks: acc.clicks + Number(m.clicks ?? 0),
      impressions: acc.impressions + Number(m.impressions ?? 0),
      urls: acc.urls + Number(m.url_count ?? 0),
      withData: acc.withData + Number(m.urls_with_data ?? 0),
      growing: acc.growing + Number(m.growing_urls ?? 0),
      declining: acc.declining + Number(m.declining_urls ?? 0),
    }),
    { clicks: 0, impressions: 0, urls: 0, withData: 0, growing: 0, declining: 0 },
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader
        title="Team overview"
        description={`Aggregated across all members and projects — ${RANGE_LABELS[range] ?? range}.`}
        action={<RangeSwitcher value={range} onChange={setRange} />}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Members" value={String(members.length)} />
        <StatCard label="Projects" value={String(projects.length)} />
        <StatCard
          label="URLs"
          value={formatNumber(totals.urls)}
          sub={`${formatNumber(totals.withData)} with data`}
        />
        <StatCard label="Clicks" value={formatNumber(totals.clicks)} />
        <StatCard label="Impressions" value={formatNumber(totals.impressions)} />
        <StatCard
          label="Growing / Declining"
          value={`${totals.growing} / ${totals.declining}`}
          sub="URLs vs. previous period"
        />
      </div>

      <SyncRefreshPanel onDone={() => setDataVersion((v) => v + 1)} />
      <DataQualityPanel refreshKey={dataVersion} />
      <RunHistoryPanel refreshKey={dataVersion} />
    </div>
  );
}
