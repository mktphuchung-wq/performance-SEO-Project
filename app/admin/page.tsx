"use client";

import { useEffect, useState } from "react";
import { DataQualityPanel } from "@/components/DataQualityPanel";
import { MetricDeltaInline } from "@/components/MetricDelta";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { RunHistoryPanel } from "@/components/RunHistoryPanel";
import { StatCard } from "@/components/StatCard";
import { SyncRefreshPanel } from "@/components/SyncRefreshPanel";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { fetchJson, messageOf } from "@/lib/http/fetch-json";
import { RANGE_LABELS, formatCtr, formatNumber, formatOfficialKpi } from "@/lib/format";
import { aggregateRollups } from "@/lib/performance/aggregate";
import { DEFAULT_RANGE_KEY } from "@/lib/ranges";
import type { MemberRollupRow, ProjectRollupRow } from "@/lib/repositories/rollups";

interface TeamKpiSummary {
  avgOfficialKpi: number | null;
  scoredMemberCount: number;
  memberCount: number;
}

interface RowsResponse<T> { rows: T[] }
interface KpiResponse extends TeamKpiSummary { rows: unknown[] }
const EMPTY_KPI: TeamKpiSummary = { avgOfficialKpi: null, scoredMemberCount: 0, memberCount: 0 };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasRows = <T,>(value: unknown): value is RowsResponse<T> => isObject(value) && Array.isArray(value.rows);
const hasKpi = (value: unknown): value is KpiResponse => isObject(value) && Array.isArray(value.rows) && typeof value.scoredMemberCount === "number" && typeof value.memberCount === "number";

export default function AdminOverviewPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [rangeRevision, setRangeRevision] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);
  const [members, setMembers] = useState<MemberRollupRow[]>([]);
  const [projects, setProjects] = useState<ProjectRollupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpi, setKpi] = useState<TeamKpiSummary>(EMPTY_KPI);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [kpiError, setKpiError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setMembers([]);
    setProjects([]);
    void Promise.all([
      fetchJson<RowsResponse<MemberRollupRow>>(`/api/admin/members?range=${range}`, { signal: controller.signal }, hasRows<MemberRollupRow>),
      fetchJson<RowsResponse<ProjectRollupRow>>(`/api/admin/projects?range=${range}`, { signal: controller.signal }, hasRows<ProjectRollupRow>),
    ])
      .then(([memberResponse, projectResponse]) => {
        if (controller.signal.aborted) return;
        setMembers(memberResponse.rows);
        setProjects(projectResponse.rows);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setError(messageOf(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range, rangeRevision, dataVersion]);

  useEffect(() => {
    const controller = new AbortController();
    setKpiLoading(true);
    setKpiError(null);
    setKpi(EMPTY_KPI);
    void fetchJson<KpiResponse>("/api/admin/kpi/members/summary", { signal: controller.signal }, hasKpi)
      .then((body) => {
        if (!controller.signal.aborted) setKpi({ avgOfficialKpi: body.avgOfficialKpi, scoredMemberCount: body.scoredMemberCount, memberCount: body.memberCount });
      })
      .catch((requestError: unknown) => !controller.signal.aborted && setKpiError(messageOf(requestError)))
      .finally(() => !controller.signal.aborted && setKpiLoading(false));
    return () => controller.abort();
  }, [dataVersion]);

  function changeRange(next: string) {
    setMembers([]);
    setProjects([]);
    setLoading(true);
    setError(null);
    setRange(next);
  }

  function retry() {
    setRangeRevision((value) => value + 1);
    setDataVersion((value) => value + 1);
  }

  const totals = aggregateRollups(members);
  const hasData = members.length > 0 || projects.length > 0;
  const ready = !loading && !error && hasData;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader title="Team overview" description={`Aggregated across all members and projects — ${RANGE_LABELS[range] ?? range}.`} action={<RangeSwitcher value={range} onChange={changeRange} />} />

      {(error || kpiError) && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-negative-soft px-4 py-3 text-[13px] text-negative">
          <span>{error ?? `Official KPI: ${kpiError}`}</span>
          <Button variant="secondary" onClick={retry}>Try again</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Avg Official KPI" value={kpiLoading || kpiError ? "—" : formatOfficialKpi(kpi.avgOfficialKpi)} sub={kpiLoading ? "Loading…" : kpiError ? "Could not load KPI" : `${kpi.scoredMemberCount} of ${kpi.memberCount} members scored · not affected by the range`} />
        <StatCard label="Clicks" value={ready ? formatNumber(totals.clicks) : "—"} sub={ready ? <MetricDeltaInline delta={totals.clickDelta} pct={totals.clickGrowthPct} previous={totals.previousClicks} /> : loading ? "Loading…" : error ? "Could not load data" : "No synced data yet"} />
        <StatCard label="Impressions" value={ready ? formatNumber(totals.impressions) : "—"} sub={ready ? <MetricDeltaInline delta={totals.impressionDelta} pct={totals.impressionGrowthPct} previous={totals.previousImpressions} /> : undefined} />
        <StatCard label="CTR" value={ready ? formatCtr(totals.ctr) : "—"} sub={ready ? "clicks ÷ impressions" : undefined} />
        <StatCard label="Growing / Declining" value={ready ? `${totals.growing} / ${totals.declining}` : "—"} sub={ready ? `${formatNumber(totals.noData)} URLs without data` : undefined} />
        <StatCard label="URLs" value={ready ? formatNumber(totals.urls) : "—"} sub={ready ? `${formatNumber(totals.withData)} with data` : undefined} />
        <StatCard label="Members" value={ready ? String(members.length) : "—"} />
        <StatCard label="Projects" value={ready ? String(projects.length) : "—"} />
      </div>

      {!loading && !error && !hasData && <EmptyState title="No performance data yet" hint="Configure mappings, sync the content sheet, then refresh Search Console data." />}

      <SyncRefreshPanel onDone={() => setDataVersion((value) => value + 1)} />
      <DataQualityPanel refreshKey={dataVersion} />
      <RunHistoryPanel refreshKey={dataVersion} />
    </div>
  );
}
