"use client";

import Link from "next/link";
import { DATA_STATUS_LABELS, formatCtr, formatNumber, formatPosition } from "@/lib/format";
import { MetricDelta } from "@/components/MetricDelta";
import { Badge, EmptyState, type BadgeTone } from "@/components/ui";

export interface PerformanceTableRow {
  content_url_id: string;
  url: string;
  project: string;
  member_name: string;
  work_type: string;
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
}: {
  rows: PerformanceTableRow[];
  showMember?: boolean;
  /** Supplied only by the admin view — its presence is what adds the KPI column. */
  onToggleKpiExclusion?: (row: PerformanceTableRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No URLs in this range yet."
        hint="Run Sync and Refresh from Admin → Overview to populate it."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1080px] text-sm">
        <thead>
          <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium uppercase tracking-wide text-ink-subtle">
            <th className="px-4 py-2.5">URL</th>
            <th className="px-4 py-2.5">Project</th>
            {showMember && <th className="px-4 py-2.5">Member</th>}
            <th className="px-4 py-2.5">Type</th>
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
        <tbody>
          {rows.map((row) => (
            <tr key={row.content_url_id} className="border-b border-line last:border-0 hover:bg-neutral-soft/50">
              <td className="max-w-[260px] px-4 py-2.5">
                <Link
                  href={`/dashboard/url/${row.content_url_id}`}
                  className="block truncate font-medium text-accent hover:text-accent-hover hover:underline"
                  title={row.url}
                >
                  {shortenUrl(row.url)}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-ink-muted">{row.project || "—"}</td>
              {showMember && <td className="px-4 py-2.5 text-ink-muted">{row.member_name || "—"}</td>}
              <td className="px-4 py-2.5 text-ink-muted">{row.work_type || "—"}</td>
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
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
