"use client";

import { formatCtr, formatNumber, formatPosition } from "@/lib/format";
import { MetricDelta } from "@/components/MetricDelta";
import { EmptyState } from "@/components/ui";

export interface RollupTableRow {
  key: string;
  label: string;
  url_count: number;
  urls_with_data: number;
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
  growing_urls: number;
  declining_urls: number;
  no_data_urls: number;
}

/**
 * Shared body for the member and project comparison views — the two differ only
 * in the label of the first column.
 */
export function RollupTable({ rows, entityLabel }: { rows: RollupTableRow[]; entityLabel: string }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No rollup for this range yet."
        hint="Refresh this range from Admin → Overview to compute it."
      />
    );
  }

  // Bar width is relative to the busiest row, so the ranking is readable at a glance.
  const maxClicks = Math.max(...rows.map((r) => Number(r.clicks ?? 0)), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] text-sm">
        <thead>
          <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium uppercase tracking-wide text-ink-subtle">
            <th className="px-4 py-2.5">{entityLabel}</th>
            <th className="px-4 py-2.5 text-right">URLs</th>
            <th className="px-4 py-2.5 text-right">Clicks</th>
            <th className="px-4 py-2.5">Share</th>
            <th className="px-4 py-2.5 text-right">Δ Clicks</th>
            <th className="px-4 py-2.5 text-right">Impressions</th>
            <th className="px-4 py-2.5 text-right">Δ Impressions</th>
            <th className="px-4 py-2.5 text-right">CTR</th>
            <th className="px-4 py-2.5 text-right">Avg pos.</th>
            <th className="px-4 py-2.5 text-right">Growing</th>
            <th className="px-4 py-2.5 text-right">Declining</th>
            <th className="px-4 py-2.5 text-right">No data</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line last:border-0 hover:bg-neutral-soft/50">
              <td className="px-4 py-2.5 font-medium text-ink">{row.label}</td>
              <td className="numeric px-4 py-2.5 text-right text-ink-muted">
                {row.url_count}
                <span className="text-ink-subtle"> / {row.urls_with_data}</span>
              </td>
              <td className="numeric px-4 py-2.5 text-right font-medium text-ink">{formatNumber(row.clicks)}</td>
              <td className="px-4 py-2.5">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-soft">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(Number(row.clicks ?? 0) / maxClicks) * 100}%` }}
                  />
                </div>
              </td>
              <td className="px-4 py-2.5 text-right">
                <MetricDelta delta={row.click_delta} pct={row.click_growth_pct} previous={row.previous_clicks} />
              </td>
              <td className="numeric px-4 py-2.5 text-right text-ink">{formatNumber(row.impressions)}</td>
              <td className="px-4 py-2.5 text-right">
                <MetricDelta
                  delta={row.impression_delta}
                  pct={row.impression_growth_pct}
                  previous={row.previous_impressions}
                />
              </td>
              <td className="numeric px-4 py-2.5 text-right text-ink-muted">{formatCtr(row.ctr)}</td>
              <td className="numeric px-4 py-2.5 text-right text-ink-muted">{formatPosition(row.position)}</td>
              <td className="numeric px-4 py-2.5 text-right text-positive">{row.growing_urls}</td>
              <td className="numeric px-4 py-2.5 text-right text-negative">{row.declining_urls}</td>
              <td className="numeric px-4 py-2.5 text-right text-ink-subtle">{row.no_data_urls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
