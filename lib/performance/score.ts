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
}

const NOT_SCORED: Omit<UrlScoreResult, "state"> = {
  clickRatio: null,
  impressionRatio: null,
  clickScore: null,
  impressionScore: null,
  score: null,
  weight: 0,
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

  const clickRatio = ratioOf(input.currentClicks, input.previousClicks, settings.smoothingConstant);
  const impressionRatio = ratioOf(input.currentImpressions, input.previousImpressions, settings.smoothingConstant);

  const clickScore = clampScore(Math.log2(clickRatio), sensitivity);
  const impressionScore = clampScore(Math.log2(impressionRatio), sensitivity);

  const score = clickScore * settings.clickWeight + impressionScore * settings.impressionWeight;

  // A null previous counts as 0 here too, which makes the weight of a URL with
  // no history low by construction. That is the mechanism that keeps very new
  // URLs from swinging a member's average — it replaces the grace period the
  // earlier design needed, without needing a state or a configurable window.
  const weight = (Number(input.previousImpressions ?? 0) + Number(input.currentImpressions ?? 0)) / 2;

  return { state: "normal", clickRatio, impressionRatio, clickScore, impressionScore, score, weight };
}

export interface ScoreAggregate {
  kpiScore: number | null;
  eligibleUrlCount: number;
  excludedUrlCount: number;
  noDataUrlCount: number;
  cappedUrlCount: number;
  totalWeight: number;
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

  const totalWeight = cappedWeights.reduce((a, b) => a + b, 0);
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
