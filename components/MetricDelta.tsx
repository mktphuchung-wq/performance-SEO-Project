"use client";

import { formatDelta, formatGrowthPct, formatNumber } from "@/lib/format";

/**
 * Change against the previous period, shown as both the absolute move and the
 * percentage. Either one alone is misleading: "+300%" hides that it went 1 → 4,
 * and "+1,204" hides whether that is a rounding blip or a doubling.
 *
 * A missing delta renders as "—", never as 0 — no previous-period signal is not
 * the same as no change.
 */

function tone(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-ink-muted";
  return value > 0 ? "text-positive" : "text-negative";
}

function arrow(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "•";
  return value > 0 ? "▲" : "▼";
}

export interface MetricDeltaProps {
  delta: number | null | undefined;
  pct: number | null | undefined;
  /** Previous-period value, surfaced as a tooltip when present. */
  previous?: number | null;
  /** Anything other than "ok" means there is no comparable measurement. */
  dataStatus?: string;
}

/** Two-line cell for tables: absolute change above, percentage below. */
export function MetricDelta({ delta, pct, previous, dataStatus }: MetricDeltaProps) {
  const hasData = dataStatus === undefined || dataStatus === "ok";
  if (!hasData || (delta === null && pct === null) || (delta === undefined && pct === undefined)) {
    return <span className="text-ink-subtle">—</span>;
  }

  const colour = tone(delta ?? pct);
  const title = previous === null || previous === undefined ? undefined : `Previous period: ${formatNumber(previous)}`;

  return (
    <span className={`inline-flex flex-col items-end leading-tight ${colour}`} title={title}>
      <span className="numeric text-[13px] font-medium">{formatDelta(delta)}</span>
      <span className="numeric text-[11px] opacity-80">
        <span aria-hidden="true" className="mr-0.5">
          {arrow(delta ?? pct)}
        </span>
        {formatGrowthPct(pct)}
      </span>
    </span>
  );
}

/** Single-line variant for stat cards and other prose-like contexts. */
export function MetricDeltaInline({ delta, pct, previous, dataStatus }: MetricDeltaProps) {
  const hasData = dataStatus === undefined || dataStatus === "ok";
  if (!hasData || (delta === null && pct === null) || (delta === undefined && pct === undefined)) {
    return <span className="text-ink-subtle">no previous period</span>;
  }

  const colour = tone(delta ?? pct);
  const title = previous === null || previous === undefined ? undefined : `Previous period: ${formatNumber(previous)}`;

  return (
    <span title={title}>
      <span className={`numeric font-medium ${colour}`}>
        <span aria-hidden="true" className="mr-0.5 text-[10px]">
          {arrow(delta ?? pct)}
        </span>
        {formatDelta(delta)}
      </span>{" "}
      <span className={`numeric ${colour}`}>({formatGrowthPct(pct)})</span>{" "}
      <span className="text-ink-muted">vs. previous</span>
    </span>
  );
}
