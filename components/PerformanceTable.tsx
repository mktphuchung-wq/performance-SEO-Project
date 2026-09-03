"use client";

import Link from "next/link";
import {
  DATA_STATUS_LABELS,
  WARNING_LEVEL_LABELS,
  formatCtr,
  formatDate,
  formatNumber,
  formatPosition,
} from "@/lib/format";
import { MetricDelta } from "@/components/MetricDelta";
import { Badge, EmptyState, type BadgeTone } from "@/components/ui";
import { TableViewBody, TableViewControls, TableViewport, useTableView } from "@/components/TableView";

export interface PerformanceTableRow {
  content_url_id: string;
  url: string;
  project: string;
  member_name: string;
  work_type: string;
  first_worked_at?: string | null;
  worked_at?: string | null;
  published_at?: string | null;
  /** Work events inside the period being viewed; null when no period applies. */
  period_work_count?: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
  previous_clicks: number | null;
  previous_impressions: number | null;
  click_delta: number | null;
  click_growth_pct: number | null;
  impression_delta: number | null;
  impression_growth_pct: number | null;
  data_status: string;
  growth_status: string;
  error_message?: string | null;
  kpi_excluded?: boolean;
  kpi_excluded_reason?: string | null;
}

const statusTone: Record<string, BadgeTone> = {
  ok: "positive",
  no_data: "neutral",
  not_eligible: "warning",
  error: "negative",
};

function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    return path ? path : parsed.hostname;
  } catch {
    return url;
  }
}

export function PerformanceTable({
  rows,
  showMember = false,
  onToggleKpiExclusion,
  onInspectHistory,
  warningLevelByUrlId,
}: {
  rows: PerformanceTableRow[];
  showMember?: boolean;
  /** Supplied only by the admin view — its presence is what adds the KPI column. */
  onToggleKpiExclusion?: (row: PerformanceTableRow) => void;
  onInspectHistory?: (row: PerformanceTableRow) => void;
  /**
   * Open warning level per URL, if the caller already has it. A marker only —
   * a flagged URL is one somebody should look at, not one that has been scored
   * differently, and no number in this table changes because of it.
   */
  warningLevelByUrlId?: Record<string, string>;
}) {
  const view = useTableView(
    rows,
    [
      { id: "url", label: "URL", value: (row) => row.url },
      { id: "project", label: "Project", value: (row) => row.project, groupable: true },
      ...(showMember
        ? [{ id: "member", label: "Member", value: (row: PerformanceTableRow) => row.member_name, groupable: true }]
        : []),
      { id: "type", label: "Type", value: (row) => row.work_type, groupable: true },
      { id: "first_worked", label: "First worked", value: (row) => row.first_worked_at, type: "date" as const },
      { id: "last_worked", label: "Last worked", value: (row) => row.worked_at, type: "date" as const },
      { id: "clicks", label: "Clicks", value: (row) => row.clicks, type: "number" as const },
      { id: "click_delta", label: "Δ Clicks", value: (row) => row.click_delta, type: "number" as const },
      { id: "impressions", label: "Impressions", value: (row) => row.impressions, type: "number" as const },
      { id: "impression_delta", label: "Δ Impressions", value: (row) => row.impression_delta, type: "number" as const },
      { id: "ctr", label: "CTR", value: (row) => row.ctr, type: "number" as const },
      { id: "position", label: "Avg position", value: (row) => row.position, type: "number" as const },
      { id: "status", label: "Status", value: (row) => DATA_STATUS_LABELS[row.data_status] ?? row.data_status, groupable: true },
      ...(onToggleKpiExclusion
        ? [{
            id: "kpi",
            label: "KPI",
            value: (row: PerformanceTableRow) => (row.kpi_excluded ? "Excluded" : "Counted"),
            groupable: true,
          }]
        : []),
    ],
    { initialSort: { column: "clicks", direction: "desc" } },
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No URLs in this range yet."
        hint="Run Sync and Refresh from Admin → Overview to populate it."
      />
    );
  }

  return (
    <div>
      <TableViewControls view={view} noun="URLs" />
      <TableViewport view={view}>
        <table className="w-full min-w-[1240px] text-sm">
        <thead>
          <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium uppercase tracking-wide text-ink-subtle">
            <th className="px-4 py-2.5">URL</th>
            <th className="px-4 py-2.5">Project</th>
            {showMember && <th className="px-4 py-2.5">Member</th>}
            <th className="px-4 py-2.5">Type</th>
            <th className="px-4 py-2.5" title="First work event on this URL">First worked</th>
            <th className="px-4 py-2.5" title="Most recent work event on this URL">Last worked</th>
            <th className="px-4 py-2.5 text-right">Clicks</th>
            <th className="px-4 py-2.5 text-right">Δ Clicks</th>
            <th className="px-4 py-2.5 text-right">Impressions</th>
            <th className="px-4 py-2.5 text-right">Δ Impressions</th>
            <th className="px-4 py-2.5 text-right">CTR</th>
            <th className="px-4 py-2.5 text-right">Avg pos.</th>
            <th className="px-4 py-2.5">Status</th>
            {onToggleKpiExclusion && <th className="px-4 py-2.5">KPI</th>}
          </tr>
        </thead>
        <TableViewBody
          view={view}
          colSpan={13 + (showMember ? 1 : 0) + (onToggleKpiExclusion ? 1 : 0)}
          renderRow={(row) => (
            <tr key={row.content_url_id} className="border-b border-line last:border-0 hover:bg-neutral-soft/50">
              <td className="max-w-[260px] px-4 py-2.5">
                <Link
                  href={`/dashboard/url/${row.content_url_id}`}
                  className="block truncate font-medium text-accent hover:text-accent-hover hover:underline"
                  title={row.url}
                >
                  {shortenUrl(row.url)}
                </Link>
                {warningLevelByUrlId?.[row.content_url_id] && (
                  <span className="mt-1 inline-block">
                    <Badge tone={warningLevelByUrlId[row.content_url_id] === "mandatory_audit" ? "negative" : "warning"}>
                      {WARNING_LEVEL_LABELS[warningLevelByUrlId[row.content_url_id]] ?? "Flagged"}
                    </Badge>
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5 text-ink-muted">{row.project || "—"}</td>
              {showMember && <td className="px-4 py-2.5 text-ink-muted">{row.member_name || "—"}</td>}
              <td className="px-4 py-2.5 text-ink-muted">{row.work_type || "—"}</td>
              <td
                className="whitespace-nowrap px-4 py-2.5 numeric text-ink-muted"
                title={row.published_at ? `Published ${formatDate(row.published_at)}` : "No publish date — already live"}
              >
                {formatDate(row.first_worked_at)}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 numeric text-ink-muted">
                {formatDate(row.worked_at)}
                {/* Only ever shown when a period is in play. It is the difference
                    between "this member worked on it this period" and "they just
                    happen to own it", which is what the KPI attribution turns on. */}
                {row.period_work_count === 0 && (
                  <span className="block text-xs text-ink-subtle" title="No work event inside the selected period">
                    not this period
                  </span>
                )}
              </td>
              <td className="numeric px-4 py-2.5 text-right font-medium text-ink">{formatNumber(row.clicks)}</td>
              <td className="px-4 py-2.5 text-right">
                <MetricDelta
                  delta={row.click_delta}
                  pct={row.click_growth_pct}
                  previous={row.previous_clicks}
                  dataStatus={row.data_status}
                />
              </td>
              <td className="numeric px-4 py-2.5 text-right text-ink">{formatNumber(row.impressions)}</td>
              <td className="px-4 py-2.5 text-right">
                <MetricDelta
                  delta={row.impression_delta}
                  pct={row.impression_growth_pct}
                  previous={row.previous_impressions}
                  dataStatus={row.data_status}
                />
              </td>
              <td className="numeric px-4 py-2.5 text-right text-ink-muted">{formatCtr(row.ctr)}</td>
              <td className="numeric px-4 py-2.5 text-right text-ink-muted">{formatPosition(row.position)}</td>
              <td className="px-4 py-2.5">
                <span title={row.error_message ?? undefined}>
                  <Badge tone={statusTone[row.data_status] ?? "neutral"}>
                    {DATA_STATUS_LABELS[row.data_status] ?? row.data_status}
                  </Badge>
                </span>
                {row.error_message && (
                  <p className="mt-1 max-w-[240px] text-xs leading-4 text-negative">{row.error_message}</p>
                )}
              </td>
              {onToggleKpiExclusion && (
                <td className="px-4 py-2.5">
                  <div className="flex flex-col items-start gap-1">
                    {row.kpi_excluded ? (
                      <Badge tone="warning">Excluded</Badge>
                    ) : (
                      <Badge tone="neutral">Counted</Badge>
                    )}
                    <button
                      onClick={() => onToggleKpiExclusion(row)}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      {row.kpi_excluded ? "Include" : "Exclude"}
                    </button>
                    {row.kpi_excluded_reason && (
                      <span className="max-w-[160px] text-xs leading-4 text-ink-subtle">
                        {row.kpi_excluded_reason}
                      </span>
                    )}
                    {onInspectHistory && (
                      <button
                        onClick={() => onInspectHistory(row)}
                        className="text-xs font-medium text-accent hover:underline"
                        title="Monthly history and anomaly flags used as this URL's baseline"
                      >
                        Baseline…
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          )}
        />
        </table>
      </TableViewport>
    </div>
  );
}
