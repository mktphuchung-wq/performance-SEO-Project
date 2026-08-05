"use client";

import Link from "next/link";
import { DATA_STATUS_LABELS, formatGrowthPct, formatNumber, formatPosition } from "@/lib/format";
import { Badge, EmptyState, type BadgeTone } from "@/components/ui";

export interface PerformanceTableRow {
  content_url_id: string;
  url: string;
  project: string;
  member_name: string;
  work_type: string;
  clicks: number | null;
  impressions: number | null;
  position: number | null;
  click_growth_pct: number | null;
  data_status: string;
  growth_status: string;
  error_message?: string | null;
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

function GrowthCell({ value, dataStatus }: { value: number | null; dataStatus: string }) {
  if (dataStatus !== "ok" || value === null || value === undefined) {
    return <span className="text-ink-subtle">—</span>;
  }
  const tone = value > 0 ? "text-positive" : value < 0 ? "text-negative" : "text-ink-muted";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "•";
  return (
    <span className={`numeric font-medium ${tone}`}>
      <span aria-hidden="true" className="mr-1 text-[10px]">
        {arrow}
      </span>
      {formatGrowthPct(value)}
    </span>
  );
}

export function PerformanceTable({ rows, showMember = false }: { rows: PerformanceTableRow[]; showMember?: boolean }) {
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
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium uppercase tracking-wide text-ink-subtle">
            <th className="px-4 py-2.5">URL</th>
            <th className="px-4 py-2.5">Project</th>
            {showMember && <th className="px-4 py-2.5">Member</th>}
            <th className="px-4 py-2.5">Type</th>
            <th className="px-4 py-2.5 text-right">Clicks</th>
            <th className="px-4 py-2.5 text-right">Impressions</th>
            <th className="px-4 py-2.5 text-right">Avg pos.</th>
            <th className="px-4 py-2.5 text-right">Click growth</th>
            <th className="px-4 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.content_url_id} className="border-b border-line last:border-0 hover:bg-neutral-soft/50">
              <td className="max-w-[280px] px-4 py-2.5">
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
              <td className="numeric px-4 py-2.5 text-right text-ink">{formatNumber(row.impressions)}</td>
              <td className="numeric px-4 py-2.5 text-right text-ink-muted">{formatPosition(row.position)}</td>
              <td className="px-4 py-2.5 text-right">
                <GrowthCell value={row.click_growth_pct} dataStatus={row.data_status} />
              </td>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
