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

interface RowsResponse<T> {
  rows?: T[];
  error?: string;
}

const EMPTY_KPI: TeamKpiSummary = { avgOfficialKpi: null, scoredMemberCount: 0, memberCount: 0 };

async function fetchRows<T>(url: string, signal: AbortSignal): Promise<T[]> {
  const response = await fetch(url, { signal });
  const text = await response.text();

  if (!text.trim()) {
    console.error("Admin overview API returned an empty response", {
      url,
      status: response.status,
      contentType: response.headers.get("content-type"),
    });
    throw new Error(`Failed to load admin data: ${url} returned an empty response (${response.status}).`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    console.error("Admin overview API returned invalid JSON", {
      url,
      status: response.status,
      contentType: response.headers.get("content-type"),
      responsePreview: text.slice(0, 200),
      error,
    });
    throw new Error(`Failed to load admin data: ${url} returned invalid JSON (${response.status}).`);
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    console.error("Admin overview API returned an invalid JSON payload", { url, status: response.status, payload });
    throw new Error(`Failed to load admin data: ${url} returned an invalid JSON payload.`);
  }

  const body = payload as RowsResponse<T>;

  if (!response.ok) {
    console.error("Admin overview API request failed", { url, status: response.status, body });
    throw new Error(body.error ?? `Failed to load admin data from ${url} (${response.status}).`);
  }

  if (body.rows !== undefined && !Array.isArray(body.rows)) {
    console.error("Admin overview API returned an invalid rows payload", { url, status: response.status, body });
    throw new Error(`Failed to load admin data: ${url} returned an invalid rows payload.`);
  }

  return body.rows ?? [];
}

export default function AdminOverviewPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [members, setMembers] = useState<MemberRollupRow[]>([]);
  const [projects, setProjects] = useState<ProjectRollupRow[]>([]);
  const [kpi, setKpi] = useState<TeamKpiSummary>(EMPTY_KPI);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    Promise.all([
      fetchRows<MemberRollupRow>(`/api/admin/members?range=${range}`, controller.signal),
      fetchRows<ProjectRollupRow>(`/api/admin/projects?range=${range}`, controller.signal),
    ])
      .then(([memberRows, projectRows]) => {
        if (controller.signal.aborted) return;
        setMembers(memberRows);
        setProjects(projectRows);
        setError(null);
      })
      .catch((requestError: Error) => {
        if (!controller.signal.aborted && requestError.name !== "AbortError") {
          console.error("Failed to load admin overview", { range, error: requestError });
          // Drop the previous range's rows: the header and every StatCard are
          // already labelled with the new range, so keeping them would present
          // stale numbers as if they belonged to the range that failed to load.
          setMembers([]);
          setProjects([]);
          setError(requestError.message);
        }
      });

    return () => controller.abort();
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

      {error && <p className="rounded-lg bg-negative-soft px-4 py-3 text-[13px] text-negative">{error}</p>}

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
