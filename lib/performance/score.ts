export type ProjectType = "new" | "growth" | "stable";
export type ScoreState = "normal" | "excluded" | "no_data";

export const PROJECT_TYPES: ProjectType[] = ["new", "growth", "stable"];

export interface KpiSettings {
  /** Growth (%) that earns a 100, per project type — e.g. { new: 50, growth: 50, stable: 15 }. */
  targetGrowthPct: Record<ProjectType, number>;
  smoothingConstant: number;
  clickWeight: number;
  impressionWeight: number;
  urlWeightCapPct: number;
}

export interface UrlScoreInput {
  projectType: ProjectType;
  dataStatus: string; // seo_performance_cache.data_status
  kpiExcluded: boolean; // content_urls.kpi_excluded
  currentClicks: number | null;
  /** Null means no measurement was ever recorded for the previous period. */
  previousClicks: number | null;
  currentImpressions: number | null;
  previousImpressions: number | null;
  /**
   * What the current period is actually graded against — a robust baseline over
   * several past periods, with anomalous ones left out. Null when no history is
   * available, which falls back to the raw previous period.
   */
  baselineClicks?: number | null;
  baselineImpressions?: number | null;
}

export interface UrlScoreResult {
  state: ScoreState;
  clickRatio: number | null;
  impressionRatio: number | null;
  clickScore: number | null;
  impressionScore: number | null;
  /** 0–100. Null whenever state !== "normal" — an unscored URL has no score, not a score of 0. */
  score: number | null;
  /** Relative influence on the aggregate, not a measurement. 0 means "no pull", which is meaningful. */
  weight: number;
  /** The figures the ratios were taken against, so a score can be explained. */
  baselineClicks: number | null;
  baselineImpressions: number | null;
}

const NOT_SCORED: Omit<UrlScoreResult, "state"> = {
  clickRatio: null,
  impressionRatio: null,
  clickScore: null,
  impressionScore: null,
  score: null,
  weight: 0,
  baselineClicks: null,
  baselineImpressions: null,
};

/**
 * Turn "the growth we expect from this kind of project" into the multiplier the
 * log-ratio is graded against.
 *
 * log2(1 + targetPct/100) is exactly the log-ratio a URL that grew by targetPct%
 * in the traditional sense produces (current = previous × (1 + targetPct/100)),
 * so hitting the target lands on 100 by construction. At a baseline large enough
 * for the smoothing constant to disappear, the whole formula converges on the
 * familiar linear-percentage behaviour — it only parts ways from it down at the
 * low baselines where the linear version was undefined or explosive.
 */
function sensitivityFor(targetGrowthPct: number): number {
  return 50 / Math.log2(1 + targetGrowthPct / 100);
}

/**
 * Smoothed ratio (Laplace-style). Defined even when previous is 0 or null —
 * never a division by zero, never infinite, so the score below is always a real
 * number in 0–100 instead of a null or a four-digit percentage.
 *
 * A null previous is treated exactly as 0: "nothing was measured" and "nothing
 * happened" are the same starting line to compare growth from. The distinction
 * that does matter — no comparable data at all — is caught earlier, by
 * dataStatus.
 */
function ratioOf(current: number | null, previous: number | null, smoothing: number): number {
  const c = Number(current ?? 0);
  const p = Number(previous ?? 0);
  return (c + smoothing) / (p + smoothing);
}

/**
 * The 0–100 clamp stays from the previous design: it is what keeps a team
 * average stable and comparable between periods. What changed is that the
 * ceiling is now reached on the log scale, so below the target the score still
 * ranks how big the growth actually was instead of flattening every positive
 * move onto 100.
 */
function clampScore(logRatio: number, sensitivity: number): number {
  return Math.max(0, Math.min(100, 50 + logRatio * sensitivity));
}

/**
 * One number to grade the current period against, out of several past periods.
 *
 * A single preceding period is a sample of one, so anything unusual about it —
 * a campaign, a viral week, a tracking gap — became the standard the next period
 * was held to. Reverting to normal after an unusual high scored as collapse, and
 * because 3M and 6M windows are rolling, that month kept poisoning the comparison
 * for months after it was over.
 *
 * Winsorizing before the mean rather than taking the median outright: at the
 * small sample counts this runs on (2 or 3 periods is typical) a median is barely
 * more robust than an average, but clamping each sample to a band around the
 * median keeps an extreme one from carrying its full magnitude in.
 *
 * The centre is the *lower* of the two middle values on an even count, not their
 * average. Averaging them lets an outlier pull the very centre it is about to be
 * clamped against — with two samples, [5000, 100] centres on 2550, and 5000 sits
 * comfortably inside the band around it. The lower median leans the baseline
 * slightly low, which errs towards crediting people rather than penalising them.
 *
 * Returns null with no samples so the caller can fall back to the previous
 * period, and the lone sample unchanged with one — which is what makes a
 * lookback of 1 identical to the behaviour this replaced.
 */
export function robustBaseline(samples: Array<number | null>, winsorizeMultiple: number): number | null {
  const values = samples.filter((value): value is number => value !== null && Number.isFinite(value));
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];

  const sorted = [...values].sort((a, b) => a - b);
  const center = sorted[Math.floor((sorted.length - 1) / 2)];

  // A median of 0 gives no band to clamp against; the plain mean is already
  // bounded by the fact that every sample is near zero.
  if (center <= 0) return values.reduce((sum, value) => sum + value, 0) / values.length;

  const lower = center / winsorizeMultiple;
  const upper = center * winsorizeMultiple;
  const clamped = values.map((value) => Math.max(lower, Math.min(upper, value)));
  return clamped.reduce((sum, value) => sum + value, 0) / clamped.length;
}

/**
 * Score one URL for one range. Pure — the repository layer joins the inputs.
 *
 * "excluded" and "no_data" produce the same outcome (not counted); they differ
 * only in the reason, which the admin UI surfaces so a score can be explained
 * rather than just asserted. Everything else, brand-new URLs included, goes
 * through one single formula.
 */
export function computeUrlScore(input: UrlScoreInput, settings: KpiSettings): UrlScoreResult {
  if (input.kpiExcluded) {
    return { state: "excluded", ...NOT_SCORED };
  }
  if (input.dataStatus !== "ok") {
    return { state: "no_data", ...NOT_SCORED };
  }

  const targetGrowthPct = settings.targetGrowthPct[input.projectType] ?? settings.targetGrowthPct.growth;
  const sensitivity = sensitivityFor(targetGrowthPct);

  const baselineClicks = input.baselineClicks ?? input.previousClicks;
  const baselineImpressions = input.baselineImpressions ?? input.previousImpressions;

  const clickRatio = ratioOf(input.currentClicks, baselineClicks, settings.smoothingConstant);
  const impressionRatio = ratioOf(input.currentImpressions, baselineImpressions, settings.smoothingConstant);

  const clickScore = clampScore(Math.log2(clickRatio), sensitivity);
  const impressionScore = clampScore(Math.log2(impressionRatio), sensitivity);

  const score = clickScore * settings.clickWeight + impressionScore * settings.impressionWeight;

  // Weighted off the same baseline the score was graded against, not the raw
  // previous period. Otherwise an anomalous month inflates the weight of the very
  // URL its own anomaly just mis-scored, and the bad score pulls harder on the
  // member's average than an honest one would.
  //
  // A null baseline counts as 0 here, which makes the weight of a URL with no
  // history low by construction. That is the mechanism that keeps very new URLs
  // from swinging a member's average — it replaces the grace period the earlier
  // design needed, without needing a state or a configurable window.
  const weight = (Number(baselineImpressions ?? 0) + Number(input.currentImpressions ?? 0)) / 2;

  return {
    state: "normal",
    clickRatio,
    impressionRatio,
    clickScore,
    impressionScore,
    score,
    weight,
    baselineClicks,
    baselineImpressions,
  };
}

export interface ScoreAggregate {
  kpiScore: number | null;
  eligibleUrlCount: number;
  excludedUrlCount: number;
  noDataUrlCount: number;
  cappedUrlCount: number;
  totalWeight: number;
}

/** The score a URL sits at when traffic held flat. Below it, a URL drags its member down. */
export const NEUTRAL_SCORE = 50;

/**
 * The per-URL weights the member average is actually taken over.
 *
 * Split out of aggregateScore because two callers need the same numbers: the
 * mean itself, and the Warning evaluator, which has to know how many points one
 * URL pulls off a member's score. Computing the cap twice would let the two
 * drift, and a "KPI drag" figure that disagrees with the KPI it claims to
 * explain is worse than no figure at all.
 */
function cappedWeightsOf(
  normal: UrlScoreResult[],
  urlWeightCapPct: number,
): { cappedWeights: number[]; totalWeight: number; cappedUrlCount: number } {
  const rawTotal = normal.reduce((sum, r) => sum + r.weight, 0);
  const capValue = rawTotal > 0 ? (urlWeightCapPct / 100) * rawTotal : 0;

  let cappedUrlCount = 0;
  const cappedWeights = normal.map((r) => {
    if (capValue > 0 && r.weight > capValue) {
      cappedUrlCount += 1;
      return capValue;
    }
    return r.weight;
  });

  return { cappedWeights, totalWeight: cappedWeights.reduce((a, b) => a + b, 0), cappedUrlCount };
}

export interface UrlContribution {
  /** Index into the results array that was passed in, so the caller can rejoin its own row. */
  index: number;
  score: number;
  weight: number;
  cappedWeight: number;
  /** 0–1 — the fraction of the member's aggregate this URL actually carries. */
  weightShare: number;
  /** max(0, 50 - score) × weightShare: points this URL takes off the member's range score. */
  dragPoints: number;
}

/**
 * How hard each URL pulls on one member's range score.
 *
 * This is the same arithmetic aggregateScore does, stopped one step earlier —
 * before the weighted scores are summed — so a single URL's share of the result
 * can be named. Feeding it the exact array a member was scored from is what
 * makes dragPoints answer "how many KPI points would this member get back if
 * this one URL had merely held flat".
 *
 * The zero-totalWeight branch mirrors the aggregate's own fallback: when no URL
 * has any impressions to rank by, every eligible URL carries an equal share, so
 * drag falls back to max(0, 50 - score) ÷ eligibleUrlCount. Never divides by
 * zero, and never silently reports 0 drag for a member whose URLs all scored 0.
 *
 * Only "normal" URLs appear. Excluded and no-data URLs have no score and no
 * weight, so they cannot drag anything.
 */
export function urlContributions(results: UrlScoreResult[], urlWeightCapPct: number): UrlContribution[] {
  const indexed = results
    .map((result, index) => ({ result, index }))
    .filter((item) => item.result.state === "normal");
  if (indexed.length === 0) return [];

  const { cappedWeights, totalWeight } = cappedWeightsOf(
    indexed.map((item) => item.result),
    urlWeightCapPct,
  );

  return indexed.map((item, position) => {
    const score = item.result.score ?? 0;
    const cappedWeight = cappedWeights[position];
    const weightShare = totalWeight > 0 ? cappedWeight / totalWeight : 1 / indexed.length;
    return {
      index: item.index,
      score,
      weight: item.result.weight,
      cappedWeight,
      weightShare,
      dragPoints: Math.max(0, NEUTRAL_SCORE - score) * weightShare,
    };
  });
}

/**
 * Traffic-weighted mean over the "normal" URLs, with a per-URL weight ceiling so
 * a single URL cannot dominate a member's score (e.g. a member with two URLs
 * where one carries 95% of the traffic).
 *
 * The cap is single-pass — it does not renormalize repeatedly. Simple and good
 * enough here; with very few URLs and extreme traffic skew the effective share
 * can still exceed the nominal cap. Stated so nobody is surprised by it.
 */
export function aggregateScore(results: UrlScoreResult[], urlWeightCapPct: number): ScoreAggregate {
  const normal = results.filter((r) => r.state === "normal");
  const counts = {
    eligibleUrlCount: normal.length,
    excludedUrlCount: results.filter((r) => r.state === "excluded").length,
    noDataUrlCount: results.filter((r) => r.state === "no_data").length,
  };

  // No eligible URL means there is nothing to score. Null, not 0 — a member with
  // no measurable work has not scored zero, they have no score.
  if (normal.length === 0) {
    return { kpiScore: null, ...counts, cappedUrlCount: 0, totalWeight: 0 };
  }

  const { cappedWeights, totalWeight, cappedUrlCount } = cappedWeightsOf(normal, urlWeightCapPct);
  const kpiScore =
    totalWeight > 0
      ? normal.reduce((sum, r, i) => sum + (r.score ?? 0) * cappedWeights[i], 0) / totalWeight
      : // Every URL has zero impressions in both periods, so traffic cannot rank
        // them. They are still scored URLs, so fall back to a plain mean.
        normal.reduce((sum, r) => sum + (r.score ?? 0), 0) / normal.length;

  return {
    kpiScore: Math.max(0, Math.min(100, kpiScore)),
    ...counts,
    cappedUrlCount,
    totalWeight,
  };
}
