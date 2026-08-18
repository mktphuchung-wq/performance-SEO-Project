import type { RollupMetrics } from "@/lib/repositories/rollups";

export interface AggregatedTotals {
  urls: number;
  withData: number;
  growing: number;
  declining: number;
  noData: number;
  clicks: number;
  impressions: number;
  ctr: number | null;
  previousClicks: number | null;
  previousImpressions: number | null;
  clickDelta: number | null;
  clickGrowthPct: number | null;
  impressionDelta: number | null;
  impressionGrowthPct: number | null;
}

function growthPct(previous: number | null, current: number): number | null {
  if (previous === null) return null;
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

/**
 * Team-wide totals from a set of member (or project) rollups.
 *
 * Rollups partition the URLs, so summing one dimension gives the team total
 * without double counting. Ranges with no previous window (all_time) carry null
 * previous values; those stay null rather than collapsing to a 0 that would read
 * as "everything is new".
 */
export function aggregateRollups(rows: RollupMetrics[]): AggregatedTotals {
  const sum = (pick: (row: RollupMetrics) => number | null | undefined) =>
    rows.reduce((total, row) => total + Number(pick(row) ?? 0), 0);

  const clicks = sum((r) => r.clicks);
  const impressions = sum((r) => r.impressions);
  const hasPrevious = rows.some((r) => r.previous_clicks !== null || r.previous_impressions !== null);
  const previousClicks = hasPrevious ? sum((r) => r.previous_clicks) : null;
  const previousImpressions = hasPrevious ? sum((r) => r.previous_impressions) : null;

  return {
    urls: sum((r) => r.url_count),
    withData: sum((r) => r.urls_with_data),
    growing: sum((r) => r.growing_urls),
    declining: sum((r) => r.declining_urls),
    noData: sum((r) => r.no_data_urls),
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    previousClicks,
    previousImpressions,
    clickDelta: previousClicks === null ? null : clicks - previousClicks,
    clickGrowthPct: growthPct(previousClicks, clicks),
    impressionDelta: previousImpressions === null ? null : impressions - previousImpressions,
    impressionGrowthPct: growthPct(previousImpressions, impressions),
  };
}
