"use client";

import { useMemo } from "react";
import { MetricDelta } from "@/components/MetricDelta";
import { Badge, EmptyState, type BadgeTone } from "@/components/ui";
import { TableViewBody, TableViewControls, TableViewport, useTableView } from "@/components/TableView";
import { formatNumber, formatScore } from "@/lib/format";
import {
  joinSummaryRows,
  volumeLabel,
  type SummaryRollupRow,
  type SummaryScoreRow,
} from "@/lib/performance/kpi-summary";
import type { ContentVolumeRow } from "@/lib/repositories/content-volume";

function scoreTone(value: number | null | undefined): BadgeTone {
  if (value === null || value === undefined) return "neutral";
  if (value >= 80) return "positive";
  if (value >= 50) return "accent";
  return "negative";
}

/**
 * One row per member (or project) with the three things that have to be read
 * together: how much content was produced, how it was graded, and how the
 * traffic actually moved. The graded score alone hides a 1 → 50 clicks jump
 * behind the same 100 as a steady climb, so the raw deltas sit right beside it.
 *
 * Sorting and filtering are in-memory: the whole range is already loaded, so
 * neither needs a round trip.
 */
export function KpiSummaryTable({
  scores,
  rollups,
  volume,
  entityLabel,
}: {
  scores: SummaryScoreRow[];
  rollups: SummaryRollupRow[];
  volume: ContentVolumeRow[];
  entityLabel: string;
}) {
  const rows = useMemo(() => joinSummaryRows(scores, rollups, volume), [scores, rollups, volume]);
  const view = useTableView(
    rows,
    [
      { id: "name", label: entityLabel, value: (row) => row.name },
      { id: "volume", label: "Số lượng", value: (row) => row.volumeTotal, type: "number" },
      { id: "score", label: "Range score", value: (row) => row.score?.kpi_score, type: "number" },
      { id: "clicks", label: "Clicks", value: (row) => row.rollup?.clicks, type: "number" },
      { id: "click_delta", label: "Δ Clicks", value: (row) => row.rollup?.click_delta, type: "number" },
      { id: "impressions", label: "Impressions", value: (row) => row.rollup?.impressions, type: "number" },
      { id: "impression_delta", label: "Δ Impressions", value: (row) => row.rollup?.impression_delta, type: "number" },
      { id: "eligible", label: "Eligible", value: (row) => row.score?.eligible_url_count, type: "number" },
      { id: "excluded", label: "Excluded", value: (row) => row.score?.excluded_url_count, type: "number" },
      { id: "no_data", label: "No data", value: (row) => row.score?.no_data_url_count, type: "number" },
      {
        id: "score_band",
        label: "Score band",
        value: (row) => {
          const score = row.score?.kpi_score;
          if (score === null || score === undefined) return "No score";
          if (score >= 80) return "80–100";
          if (score >= 50) return "50–79";
          return "Below 50";
        },
        groupable: true,
        sortable: false,
      },
    ],
    { initialSort: { column: "score", direction: "desc" } },
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing to show for this range yet."
        hint="Scores are computed when a rolling range (1M / 3M / 6M) is refreshed, or via Recompute scores in Admin → Overview."
      />
    );
  }

  return (
    <div>
      <TableViewControls view={view} noun={entityLabel.toLowerCase()} />
      <TableViewport view={view}>
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium uppercase tracking-wide text-ink-subtle">
              <th className="px-4 py-2.5">{entityLabel}</th>
              <th className="px-4 py-2.5 text-right" title="URLs worked on inside this window, by the Sheet's type column">Số lượng</th>
              <th className="px-4 py-2.5" title="Score for the selected range only — the Official KPI is the 1M/3M/6M blend above">Range score</th>
              <th className="px-4 py-2.5 text-right">Clicks</th>
              <th className="px-4 py-2.5 text-right uppercase tracking-wide">Δ Clicks</th>
              <th className="px-4 py-2.5 text-right">Impressions</th>
              <th className="px-4 py-2.5 text-right uppercase tracking-wide">Δ Impressions</th>
              <th className="px-4 py-2.5 text-right uppercase tracking-wide">Eligible</th>
              <th className="px-4 py-2.5 text-right uppercase tracking-wide">Excluded</th>
              <th className="px-4 py-2.5 text-right uppercase tracking-wide">No data</th>
            </tr>
          </thead>
          <TableViewBody
            view={view}
            colSpan={10}
            renderRow={(row) => (
              <tr key={row.name} className="border-b border-line last:border-0 hover:bg-neutral-soft/50">
                <td className="px-4 py-2.5 font-medium text-ink">{row.name}</td>
                <td className="numeric px-4 py-2.5 text-right text-ink" title={volumeLabel(row)}>
                  {volumeLabel(row)}
                </td>
                <td className="px-4 py-2.5">
                  {row.score?.kpi_score === null || row.score === null ? (
                    // Nothing eligible to score is not a score of zero.
                    <span className="text-ink-subtle" title="No eligible URL in this range">
                      —
                    </span>
                  ) : (
                    <Badge tone={scoreTone(row.score.kpi_score)}>{formatScore(row.score.kpi_score)}</Badge>
                  )}
                </td>
                <td className="numeric px-4 py-2.5 text-right font-medium text-ink">
                  {formatNumber(row.rollup?.clicks)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <MetricDelta
                    delta={row.rollup?.click_delta}
                    pct={row.rollup?.click_growth_pct}
                    previous={row.rollup?.previous_clicks}
                  />
                </td>
                <td className="numeric px-4 py-2.5 text-right text-ink">{formatNumber(row.rollup?.impressions)}</td>
                <td className="px-4 py-2.5 text-right">
                  <MetricDelta
                    delta={row.rollup?.impression_delta}
                    pct={row.rollup?.impression_growth_pct}
                    previous={row.rollup?.previous_impressions}
                  />
                </td>
                <td className="numeric px-4 py-2.5 text-right text-ink-muted">
                  {row.score ? row.score.eligible_url_count : "—"}
                </td>
                <td className="numeric px-4 py-2.5 text-right text-ink-muted">
                  {row.score ? row.score.excluded_url_count : "—"}
                </td>
                <td className="numeric px-4 py-2.5 text-right text-ink-subtle">
                  {row.score ? row.score.no_data_url_count : "—"}
                </td>
              </tr>
            )}
          />
        </table>
      </TableViewport>
    </div>
  );
}
