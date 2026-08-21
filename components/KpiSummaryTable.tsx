"use client";

import { useMemo, useState } from "react";
import { MetricDelta } from "@/components/MetricDelta";
import { Badge, EmptyState, inputClass, type BadgeTone } from "@/components/ui";
import { formatNumber, formatScore } from "@/lib/format";
import {
  filterSummaryRows,
  joinSummaryRows,
  sortSummaryRows,
  volumeLabel,
  type SortKey,
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

function SortHeader({
  label,
  sortKey,
  active,
  direction,
  onSort,
  align = "left",
  title,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  title?: string;
}) {
  return (
    <th
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={`px-4 py-2.5 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={title}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-ink ${
          active ? "text-ink" : ""
        }`}
      >
        {label}
        <span aria-hidden="true" className={active ? "" : "opacity-0"}>
          {direction === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
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
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => joinSummaryRows(scores, rollups, volume), [scores, rollups, volume]);
  const filtered = useMemo(() => filterSummaryRows(rows, search), [rows, search]);
  const sorted = useMemo(() => sortSummaryRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing to show for this range yet."
        hint="Scores are computed when a rolling range (1M / 3M / 6M) is refreshed, or via Recompute scores in Admin → Overview."
      />
    );
  }

  const headerProps = { active: false, direction: sortDir, onSort: toggleSort };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Filter by ${entityLabel.toLowerCase()}…`}
          aria-label={`Filter by ${entityLabel.toLowerCase()}`}
          className={`${inputClass} max-w-xs`}
        />
        <span className="text-[13px] text-ink-subtle">
          {sorted.length} of {rows.length} {entityLabel.toLowerCase()}
          {rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium text-ink-subtle">
              <SortHeader {...headerProps} label={entityLabel} sortKey="name" active={sortKey === "name"} />
              <SortHeader
                {...headerProps}
                label="Số lượng"
                sortKey="volume"
                active={sortKey === "volume"}
                align="right"
                title="URLs worked on inside this window, by the Sheet's type column"
              />
              <SortHeader
                {...headerProps}
                label="Range score"
                sortKey="score"
                active={sortKey === "score"}
                title="Score for the selected range only — the Official KPI is the 1M/3M/6M blend above"
              />
              <SortHeader {...headerProps} label="Clicks" sortKey="clicks" active={sortKey === "clicks"} align="right" />
              <th className="px-4 py-2.5 text-right uppercase tracking-wide">Δ Clicks</th>
              <SortHeader
                {...headerProps}
                label="Impressions"
                sortKey="impressions"
                active={sortKey === "impressions"}
                align="right"
              />
              <th className="px-4 py-2.5 text-right uppercase tracking-wide">Δ Impressions</th>
              <th className="px-4 py-2.5 text-right uppercase tracking-wide">Eligible</th>
              <th className="px-4 py-2.5 text-right uppercase tracking-wide">Excluded</th>
              <th className="px-4 py-2.5 text-right uppercase tracking-wide">No data</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
