/**
 * Current-vs-previous totals for a group of URLs, and the growth percentages
 * that come off them.
 *
 * Split out of the rollup so the member rollup and the member score read the
 * same two numbers from the same rows in the same run. The score needs the sign
 * of these percentages to decide whether a member's Click and Impression moved
 * against each other; taking that from the stored rollup instead would let the
 * displayed % and the rule that fired on it come from two different snapshots.
 *
 * Deliberately import-free, like score.ts: the verify scripts load this module
 * directly under plain Node type-stripping, with no alias loader.
 */

export interface PeriodTotalsRow {
  /** seo_performance_cache.data_status — only "ok" rows are summed. */
  dataStatus: string;
  clicks: number | null;
  impressions: number | null;
  previousClicks: number | null;
  previousImpressions: number | null;
}

export interface PeriodTotals {
  okRowCount: number;
  clicks: number;
  impressions: number;
  previousClicks: number | null;
  previousImpressions: number | null;
  clickDelta: number | null;
  impressionDelta: number | null;
  clickGrowthPct: number | null;
  impressionGrowthPct: number | null;
}

/**
 * Growth as traditionally read, with the two undefined cases named.
 *
 * A null previous is "nothing comparable was measured", which has no percentage
 * at all. A previous of exactly 0 that grew is reported as +100 rather than as
 * infinity; 0 that stayed at 0 is null, not 0% — nothing happened either period,
 * so there is no growth to report, and calling it 0% would let it count as a
 * real flat reading.
 */
export function growthPct(previous: number | null, current: number): number | null {
  if (previous === null) return null;
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

/**
 * Sum one group's periods.
 *
 * Rows without usable data are left out entirely rather than counted as zero —
 * a URL that could not be measured has not lost its traffic. If not one row in
 * the group carries a previous measurement, both previous totals stay null and
 * both percentages follow, which is what makes "no history" read as "no
 * direction" rather than as a collapse.
 */
export function periodTotals(rows: PeriodTotalsRow[]): PeriodTotals {
  const okRows = rows.filter((row) => row.dataStatus === "ok");
  const clicks = okRows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
  const impressions = okRows.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
  const hasPrevious = okRows.some((row) => row.previousClicks !== null || row.previousImpressions !== null);
  const previousClicks = hasPrevious ? okRows.reduce((sum, row) => sum + Number(row.previousClicks ?? 0), 0) : null;
  const previousImpressions = hasPrevious
    ? okRows.reduce((sum, row) => sum + Number(row.previousImpressions ?? 0), 0)
    : null;

  return {
    okRowCount: okRows.length,
    clicks,
    impressions,
    previousClicks,
    previousImpressions,
    clickDelta: previousClicks === null ? null : clicks - previousClicks,
    impressionDelta: previousImpressions === null ? null : impressions - previousImpressions,
    clickGrowthPct: growthPct(previousClicks, clicks),
    impressionGrowthPct: growthPct(previousImpressions, impressions),
  };
}
