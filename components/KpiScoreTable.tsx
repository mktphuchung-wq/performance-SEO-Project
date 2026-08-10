"use client";

import { formatNumber, formatScore } from "@/lib/format";
import { Badge, EmptyState, type BadgeTone } from "@/components/ui";

export interface KpiScoreTableRow {
  key: string;
  label: string;
  kpi_score: number | null;
  normal_url_count: number;
  new_grace_url_count: number;
  excluded_url_count: number;
  no_data_url_count: number;
  capped_url_count: number;
  total_weight: number;
}

function scoreTone(value: number | null): BadgeTone {
  if (value === null || value === undefined) return "neutral";
  if (value >= 80) return "positive";
  if (value >= 50) return "accent";
  return "negative";
}

/**
 * KPI leaderboard. Kept separate from RollupTable rather than bolted onto it —
 * the two answer different questions (how much traffic vs how well it grew) and
 * RollupTable already has two callers that should not shift underneath them.
 */
export function KpiScoreTable({ rows, entityLabel }: { rows: KpiScoreTableRow[]; entityLabel: string }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No KPI scores for this range yet."
        hint="Scores are computed when a rolling range (1M / 3M / 6M) is refreshed, or via Recompute scores in Admin → Overview."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium uppercase tracking-wide text-ink-subtle">
            <th className="px-4 py-2.5">#</th>
            <th className="px-4 py-2.5">{entityLabel}</th>
            <th className="px-4 py-2.5">KPI score</th>
            <th className="px-4 py-2.5 text-right">Scored</th>
            <th className="px-4 py-2.5 text-right">New (grace)</th>
            <th className="px-4 py-2.5 text-right">Excluded</th>
            <th className="px-4 py-2.5 text-right">No data</th>
            <th className="px-4 py-2.5 text-right">Capped</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} className="border-b border-line last:border-0 hover:bg-neutral-soft/50">
              <td className="numeric px-4 py-2.5 text-ink-subtle">{index + 1}</td>
              <td className="px-4 py-2.5 font-medium text-ink">{row.label}</td>
              <td className="px-4 py-2.5">
                {row.kpi_score === null ? (
                  // Nothing eligible to score is not a score of zero.
                  <span className="text-ink-subtle" title="No eligible URL in this range">
                    —
                  </span>
                ) : (
                  <Badge tone={scoreTone(row.kpi_score)}>{formatScore(row.kpi_score)}</Badge>
                )}
              </td>
              <td className="numeric px-4 py-2.5 text-right text-ink">{row.normal_url_count}</td>
              <td className="numeric px-4 py-2.5 text-right text-ink-muted" title="New URLs, not yet comparable">
                {row.new_grace_url_count}
              </td>
              <td className="numeric px-4 py-2.5 text-right text-ink-muted">{row.excluded_url_count}</td>
              <td className="numeric px-4 py-2.5 text-right text-ink-subtle">{row.no_data_url_count}</td>
              <td
                className="numeric px-4 py-2.5 text-right text-ink-subtle"
                title={`URLs whose weight hit the per-URL cap · total weight ${formatNumber(row.total_weight)}`}
              >
                {row.capped_url_count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
