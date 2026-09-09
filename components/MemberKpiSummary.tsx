"use client";

import { TrendBadge } from "@/components/TrendBadge";
import { Card } from "@/components/ui";
import { KPI_STRATEGY_HINTS, KPI_STRATEGY_LABELS, formatOfficialKpi, formatScore } from "@/lib/format";
import {
  formatWeightMix,
  weightPct,
  type KpiPeriodKey,
  type MemberCompositeKpi,
} from "@/lib/performance/composite-score";

const PERIODS: Array<{ key: KpiPeriodKey; label: string; field: "score1m" | "score3m" | "score6m"; hint: string }> = [
  { key: "last_1_month", label: "1M", field: "score1m", hint: "Momentum — reacts fastest, carries the most noise" },
  { key: "last_3_months", label: "3M", field: "score3m", hint: "Core performance — the anchor of the KPI" },
  { key: "last_6_months", label: "6M", field: "score6m", hint: "Sustainability — is the level being held?" },
];

/**
 * The one number a member is evaluated on, and the three that explain it.
 *
 * It sits above the RangeSwitcher and outside its logic on purpose: Official KPI
 * is derived from 1M + 3M + 6M together, so no selected range can change it.
 * Switching to "All time" investigates the traffic behind the score; it does not
 * make the score disappear.
 *
 * Reading order is the hierarchy: Official KPI, then direction, then the periods
 * it was built from, then the mix and coverage as fine print.
 */
export function MemberKpiSummary({
  summary,
  loading = false,
  error = null,
}: {
  summary: MemberCompositeKpi | null;
  loading?: boolean;
  error?: string | null;
}) {
  const weights = summary?.weights;
  const coverage = summary?.availablePeriodCount ?? 0;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5 px-5 py-4">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Performance KPI</div>

          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="numeric text-4xl font-medium tracking-tight text-ink">
              {loading ? "…" : formatOfficialKpi(summary?.officialKpi)}
            </span>
            <span className="text-sm text-ink-subtle">/ 100</span>
          </div>

          <div className="mt-2.5">
            {loading ? (
              <span className="text-[13px] text-ink-subtle">Loading…</span>
            ) : error ? (
              <span className="text-[13px] text-negative">{error}</span>
            ) : summary ? (
              <TrendBadge trend={summary.trend} />
            ) : (
              <span className="text-[13px] text-ink-muted">Not enough eligible data</span>
            )}
          </div>
        </div>

        {/* Supporting values. A wrapping grid rather than a row, so a narrow
            screen stacks these instead of scrolling the card sideways. */}
        <dl className="grid grid-cols-3 gap-x-6 gap-y-1 sm:gap-x-10">
          {PERIODS.map((period) => (
            <div key={period.key} className="text-center">
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle" title={period.hint}>
                {period.label}
              </dt>
              <dd className="numeric mt-1 text-xl font-medium text-ink">
                {loading ? "…" : formatScore(summary?.[period.field])}
              </dd>
              <dd className="mt-0.5 text-xs text-ink-subtle">
                {weights ? `${weightPct(weights[period.key])}%` : "—"}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-5 py-2.5 text-[13px] text-ink-subtle">
        <span>{weights ? formatWeightMix(weights) : "25% 1M · 50% 3M · 25% 6M"}</span>

        {summary && coverage < 3 && (
          <span title="Missing periods do not count as zero — the remaining weights are renormalized.">
            · Based on {coverage} of 3 periods
          </span>
        )}

        {summary?.hasCustomWeights && (
          <span title={KPI_STRATEGY_HINTS[summary.strategy]}>
            · Personal strategy: {KPI_STRATEGY_LABELS[summary.strategy] ?? summary.strategy}
          </span>
        )}

        <span className="ml-auto" title="Trend describes the direction of the three period scores. The KPI is already computed from them; it is never adjusted by the trend.">
          Trend is diagnostic only — it does not affect the KPI score.
        </span>
      </div>
    </Card>
  );
}
