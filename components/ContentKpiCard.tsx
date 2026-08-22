"use client";

import { StatCard } from "@/components/StatCard";
import { formatMonthLabel } from "@/lib/content-review/month";
import { formatContentScore, formatPercent } from "@/lib/format";
import type { ContentReviewBatch } from "@/lib/repositories/content-review";

const ROLLING_MONTHS = 3;

export interface ContentKpiCardData {
  thisMonth: ContentReviewBatch | null;
  previousMonth: ContentReviewBatch | null;
  threeMonthAvg: number | null;
  threeMonthMonths?: string[];
  scoredMonthCount: number;
  monthLabels?: { thisMonth: string; previousMonth: string } | null;
}

/**
 * The headline of a member's own Content KPI: this month, last month, the
 * rolling three-month average.
 *
 * Three cards rather than one score, because one number cannot say whether a
 * blank month means "not graded yet" or "graded badly". Every blank here is a
 * literal "—" with a line under it saying which of the two it is.
 */
export function ContentKpiCard({ data, loading }: { data: ContentKpiCardData | null; loading: boolean }) {
  const missing = ROLLING_MONTHS - (data?.scoredMonthCount ?? 0);

  function monthSub(batch: ContentReviewBatch | null, fallbackMonth: string | undefined): string {
    if (loading) return "Loading…";
    if (!batch) return fallbackMonth ? `${formatMonthLabel(fallbackMonth)} — not reviewed yet` : "Not reviewed yet";
    const target = batch.min_post > 0 ? batch.min_post : "—";
    return `${formatMonthLabel(batch.month)} · ${formatPercent(batch.avg_quality_pct)} quality · ${batch.task_count}/${target} tasks`;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard
        label="Content KPI — this month"
        value={loading ? "—" : formatContentScore(data?.thisMonth?.content_score)}
        sub={monthSub(data?.thisMonth ?? null, data?.monthLabels?.thisMonth)}
      />
      <StatCard
        label="Previous month"
        value={loading ? "—" : formatContentScore(data?.previousMonth?.content_score)}
        sub={monthSub(data?.previousMonth ?? null, data?.monthLabels?.previousMonth)}
      />
      <StatCard
        label="3-month average"
        value={loading ? "—" : formatContentScore(data?.threeMonthAvg ?? null)}
        sub={
          loading
            ? "Loading…"
            : data?.threeMonthAvg !== null && data?.threeMonthAvg !== undefined
              ? `Rolling — ${(data.threeMonthMonths ?? []).map(formatMonthLabel).join(" · ")}`
              : `Shown once 3 months are graded — ${missing} more to go`
        }
      />
    </div>
  );
}
