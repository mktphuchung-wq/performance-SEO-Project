"use client";

import { formatGrowthPct, formatNumber, formatPosition } from "@/lib/format";
import { EmptyState } from "@/components/ui";

export interface RollupTableRow {
  key: string;
  label: string;
  url_count: number;
  urls_with_data: number;
  clicks: number | null;
  impressions: number | null;
  position: number | null;
  click_growth_pct: number | null;
  growing_urls: number;
  declining_urls: number;
  no_data_urls: number;
}

function GrowthValue({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <span className="text-ink-subtle">—</span>;
  const tone = value > 0 ? "text-positive" : value < 0 ? "text-negative" : "text-ink-muted";
  return <span className={`numeric font-medium ${tone}`}>{formatGrowthPct(value)}</span>;
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
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium uppercase tracking-wide text-ink-subtle">
            <th className="px-4 py-2.5">{entityLabel}</th>
            <th className="px-4 py-2.5 text-right">URLs</th>
            <th className="px-4 py-2.5 text-right">Clicks</th>
            <th className="px-4 py-2.5">Share</th>
            <th className="px-4 py-2.5 text-right">Impressions</th>
            <th className="px-4 py-2.5 text-right">Avg pos.</th>
            <th className="px-4 py-2.5 text-right">Click growth</th>
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
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-neutral-soft">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(Number(row.clicks ?? 0) / maxClicks) * 100}%` }}
                  />
                </div>
              </td>
              <td className="numeric px-4 py-2.5 text-right text-ink">{formatNumber(row.impressions)}</td>
              <td className="numeric px-4 py-2.5 text-right text-ink-muted">{formatPosition(row.position)}</td>
              <td className="px-4 py-2.5 text-right">
                <GrowthValue value={row.click_growth_pct} />
              </td>
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
