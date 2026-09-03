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
  /** The published URL score — the 70/30 blend everyone sees on the dashboard. */
  score: number;
  /**
   * The score this URL was actually weighed at for the caller's grain. Equal to
   * `score` unless a scoreOf accessor was supplied, which is how a member whose
   * Click and Impression moved in opposite directions gets drag measured against
   * the same weights their own KPI was taken over.
   */
  effectiveScore: number;
  weight: number;
  cappedWeight: number;
  /** 0–1 — the fraction of the member's aggregate this URL actually carries. */
  weightShare: number;
  /** max(0, 50 - effectiveScore) × weightShare: points this URL takes off the member's range score. */
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
 *
 * scoreOf overrides which number the drag is measured from — never the weights.
 * A member with an opposite-sign adjustment reads each URL at their own
 * effective weights, but is still weighed over the same capped shares, so the
 * drag figures keep summing back to the KPI they claim to explain. Omitted, this
 * is byte-for-byte the function it replaced.
 */
export function urlContributions(
  results: UrlScoreResult[],
  urlWeightCapPct: number,
  scoreOf?: (result: UrlScoreResult) => number,
): UrlContribution[] {
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
    const effectiveScore = scoreOf ? scoreOf(item.result) : score;
    const cappedWeight = cappedWeights[position];
    const weightShare = totalWeight > 0 ? cappedWeight / totalWeight : 1 / indexed.length;
    return {
      index: item.index,
      score,
      effectiveScore,
      weight: item.result.weight,
      cappedWeight,
      weightShare,
      dragPoints: Math.max(0, NEUTRAL_SCORE - effectiveScore) * weightShare,
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

/**
 * Which of the two metrics, if either, is being asked to carry less weight.
 *
 * "none" is the overwhelmingly common answer and means the member is scored
 * exactly the way they always were.
 */
export type DirectionAdjustment = "none" | "click_up_impression_down" | "impression_up_click_down";

/** Stamped on every member score row so a number can be traced to the rule that produced it. */
export const MEMBER_FORMULA_VERSION = "member-opposite-sign-v1";

/** What rows written before this rule existed are stamped with by the migration. */
export const LEGACY_FORMULA_VERSION = "legacy";

/**
 * d — how much of its weight the declining metric keeps before renormalizing.
 *
 * A constant rather than a setting on purpose: changing it changes what a KPI
 * score means, so it should move together with MEMBER_FORMULA_VERSION and a
 * backtest, not quietly from a settings form. It is still passed in as a
 * parameter, so promoting it to kpi_settings later is a one-line change.
 */
export const OPPOSITE_SIGN_FACTOR = 0.5;

export interface GrowthDirection {
  clickGrowthPct: number | null;
  impressionGrowthPct: number | null;
}

export interface EffectiveWeights {
  clickWeight: number;
  impressionWeight: number;
}

export interface MemberScoreAggregate extends ScoreAggregate {
  /** The 70/30 score, before any direction rule. Identical to what aggregateScore returns. */
  baseKpiScore: number | null;
  clickComponentScore: number | null;
  impressionComponentScore: number | null;
  effectiveClickWeight: number | null;
  effectiveImpressionWeight: number | null;
  directionAdjustment: DirectionAdjustment;
  /** The d actually applied. Null when nothing was adjusted, so the column reads as evidence. */
  oppositeSignFactor: number | null;
  formulaVersion: string;
}

/**
 * Are the member's two totals moving against each other?
 *
 * Zero and null are deliberately not opposite signs. A metric that did not move,
 * or that has no comparable previous period, is not evidence that the other one
 * deserves more say — and growthPct already reports "flat from nothing" as null
 * rather than as 0. Percentages are compared unrounded: the sign is the whole
 * question, and rounding is a display concern.
 */
export function directionAdjustmentOf(growth: GrowthDirection): DirectionAdjustment {
  const click = growth.clickGrowthPct;
  const impression = growth.impressionGrowthPct;
  if (click === null || impression === null) return "none";
  if (!Number.isFinite(click) || !Number.isFinite(impression)) return "none";
  if (click > 0 && impression < 0) return "click_up_impression_down";
  if (click < 0 && impression > 0) return "impression_up_click_down";
  return "none";
}

/**
 * The weights one member is actually scored at, normalized to sum to 1.
 *
 * Only the declining side is scaled down; the growing side keeps its configured
 * weight and then simply takes up the slack the renormalization frees. That is
 * what makes the growing metric matter more without inventing a bonus.
 */
export function effectiveWeightsFor(
  settings: Pick<KpiSettings, "clickWeight" | "impressionWeight">,
  direction: DirectionAdjustment,
  factor: number,
): EffectiveWeights {
  const rawClick = direction === "impression_up_click_down" ? settings.clickWeight * factor : settings.clickWeight;
  const rawImpression = direction === "click_up_impression_down" ? settings.impressionWeight * factor : settings.impressionWeight;
  const total = rawClick + rawImpression;

  // Both weights at zero is a misconfiguration the settings API rejects, but a
  // division by it would put NaN in a KPI score rather than fail loudly.
  if (!(total > 0)) return { clickWeight: settings.clickWeight, impressionWeight: settings.impressionWeight };

  return { clickWeight: rawClick / total, impressionWeight: rawImpression / total };
}

/** The weighted mean of one component over the same capped weights the aggregate uses. */
function componentMeanOf(
  normal: UrlScoreResult[],
  cappedWeights: number[],
  totalWeight: number,
  pick: (result: UrlScoreResult) => number | null,
): number {
  const mean =
    totalWeight > 0
      ? normal.reduce((sum, r, i) => sum + (pick(r) ?? 0) * cappedWeights[i], 0) / totalWeight
      : // Same fallback aggregateScore applies when no URL has traffic to rank by.
        normal.reduce((sum, r) => sum + (pick(r) ?? 0), 0) / normal.length;
  return Math.max(0, Math.min(100, mean));
}

/**
 * A member's range score, with the Click/Impression weights re-balanced when
 * their two totals moved in opposite directions.
 *
 * Members only. A project's score stays on the configured weights — the rule is
 * about crediting a person for the metric they moved, not about re-describing a
 * project's traffic.
 *
 * baseKpiScore is aggregateScore's own output, not a re-derivation of it: the
 * one number that must not move is taken from the function that has always
 * produced it, so "the base score is unchanged" is true by construction rather
 * than by an algebraic identity that a future edit could quietly break. The
 * identity (wc·C + wi·I equals that mean, because the per-URL score is the same
 * linear blend over the same weights) still holds, and the verify script asserts
 * it — but nothing in production depends on it.
 *
 * When there is nothing to adjust the base score is returned unchanged rather
 * than re-normalized through weights that would sum to 1 anyway. That keeps
 * same-sign, zero and null members bit-identical to the previous formula no
 * matter what the settings say.
 */
export function aggregateMemberScore(
  results: UrlScoreResult[],
  settings: KpiSettings,
  growth: GrowthDirection,
  factor: number = OPPOSITE_SIGN_FACTOR,
): MemberScoreAggregate {
  const base = aggregateScore(results, settings.urlWeightCapPct);
  const directionAdjustment = directionAdjustmentOf(growth);
  const weights = effectiveWeightsFor(settings, directionAdjustment, factor);
  const shared = {
    effectiveClickWeight: weights.clickWeight,
    effectiveImpressionWeight: weights.impressionWeight,
    directionAdjustment,
    oppositeSignFactor: directionAdjustment === "none" ? null : factor,
    formulaVersion: MEMBER_FORMULA_VERSION,
  };

  // No eligible URL: no score, and no components to explain one with. The
  // weights are still recorded — they are what this member would have been
  // scored at, and an auditable row beats a row of nulls.
  if (base.kpiScore === null) {
    return {
      ...base,
      baseKpiScore: null,
      clickComponentScore: null,
      impressionComponentScore: null,
      ...shared,
    };
  }

  const normal = results.filter((r) => r.state === "normal");
  const { cappedWeights, totalWeight } = cappedWeightsOf(normal, settings.urlWeightCapPct);
  const clickComponentScore = componentMeanOf(normal, cappedWeights, totalWeight, (r) => r.clickScore);
  const impressionComponentScore = componentMeanOf(normal, cappedWeights, totalWeight, (r) => r.impressionScore);

  const kpiScore =
    directionAdjustment === "none"
      ? base.kpiScore
      : Math.max(
          0,
          Math.min(100, weights.clickWeight * clickComponentScore + weights.impressionWeight * impressionComponentScore),
        );

  return {
    ...base,
    kpiScore,
    baseKpiScore: base.kpiScore,
    clickComponentScore,
    impressionComponentScore,
    ...shared,
  };
}
