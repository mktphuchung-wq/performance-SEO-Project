export type GrowthStatus = "growing" | "declining" | "stable" | "new_signal" | "no_data";
export type DataStatus = "ok" | "no_data" | "not_eligible" | "error";

export interface PeriodMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GrowthResult {
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
  previousClicks: number | null;
  previousImpressions: number | null;
  previousCtr: number | null;
  previousPosition: number | null;
  clickDelta: number | null;
  clickGrowthPct: number | null;
  impressionDelta: number | null;
  impressionGrowthPct: number | null;
  growthStatus: GrowthStatus;
  dataStatus: DataStatus;
}

const STABLE_THRESHOLD_PCT = 1;

function growthPct(previous: number, current: number): number | null {
  if (previous === 0) {
    return current > 0 ? 100 : null;
  }
  return ((current - previous) / previous) * 100;
}

function emptyResult(dataStatus: DataStatus): GrowthResult {
  return {
    clicks: null,
    impressions: null,
    ctr: null,
    position: null,
    previousClicks: null,
    previousImpressions: null,
    previousCtr: null,
    previousPosition: null,
    clickDelta: null,
    clickGrowthPct: null,
    impressionDelta: null,
    impressionGrowthPct: null,
    growthStatus: "no_data",
    dataStatus,
  };
}

/**
 * "No Data" and "not yet eligible" are distinct from a real zero — callers must
 * check dataStatus before treating clicks/impressions as 0 in aggregates.
 */
export function computeGrowth(
  current: PeriodMetrics | null,
  previous: PeriodMetrics | null,
  eligible: boolean,
): GrowthResult {
  if (!eligible) {
    return emptyResult("not_eligible");
  }
  if (!current) {
    return emptyResult("no_data");
  }

  const hasPrevious = Boolean(previous);
  const clickDelta = hasPrevious ? current.clicks - previous!.clicks : null;
  const impressionDelta = hasPrevious ? current.impressions - previous!.impressions : null;
  const clickGrowthPct = hasPrevious ? growthPct(previous!.clicks, current.clicks) : null;
  const impressionGrowthPct = hasPrevious ? growthPct(previous!.impressions, current.impressions) : null;

  let growthStatus: GrowthStatus;
  if (!hasPrevious) {
    // No prior-period signal to compare against: a new URL gaining data is a positive event, not a decline.
    growthStatus = "new_signal";
  } else if (clickGrowthPct === null || Math.abs(clickGrowthPct) <= STABLE_THRESHOLD_PCT) {
    growthStatus = "stable";
  } else if (clickGrowthPct > STABLE_THRESHOLD_PCT) {
    growthStatus = "growing";
  } else {
    growthStatus = "declining";
  }

  return {
    clicks: current.clicks,
    impressions: current.impressions,
    ctr: current.ctr,
    position: current.position,
    previousClicks: previous?.clicks ?? null,
    previousImpressions: previous?.impressions ?? null,
    previousCtr: previous?.ctr ?? null,
    previousPosition: previous?.position ?? null,
    clickDelta,
    clickGrowthPct,
    impressionDelta,
    impressionGrowthPct,
    growthStatus,
    dataStatus: "ok",
  };
}
