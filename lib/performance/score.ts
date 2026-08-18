export type ProjectType = "new" | "growth" | "stable";
export type ScoreState = "normal" | "new_grace" | "excluded" | "no_data";

export const PROJECT_TYPES: ProjectType[] = ["new", "growth", "stable"];

export interface KpiSettings {
  coefficient: Record<ProjectType, number>;
  newUrlGraceDays: number;
  clickWeight: number;
  impressionWeight: number;
  urlWeightCapPct: number;
}

export interface UrlScoreInput {
  projectType: ProjectType;
  dataStatus: string; // seo_performance_cache.data_status
  growthStatus: string; // seo_performance_cache.growth_status
  kpiExcluded: boolean; // content_urls.kpi_excluded
  workedAt: string | null; // content_urls.worked_at
  endDate: string; // range end_date, used to age the URL
  /** Range's previous_end_date — the last day a baseline could have been recorded. */
  previousEndDate: string | null;
  clickGrowthPct: number | null;
  impressionGrowthPct: number | null;
  currentImpressions: number | null;
  previousImpressions: number | null;
}

export interface UrlScoreResult {
  state: ScoreState;
  clickScore: number | null;
  impressionScore: number | null;
  /** 0–100. Null whenever state !== "normal" — an unscored URL has no score, not a score of 0. */
  score: number | null;
  /** Relative influence on the aggregate, not a measurement. 0 means "no pull", which is meaningful. */
  weight: number;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

/**
 * Map a growth percentage onto a 0–100 band. 0% growth scores 50 (flat is
 * average); the coefficient decides how much growth is needed to reach 100.
 *
 * The clamp is what stops one freak URL (1 → 10 clicks, +900%) from outranking
 * steady performers: it tops out at the same 100 as a URL that grew reliably,
 * never higher.
 */
function clampScore(growthPct: number | null, coefficient: number): number | null {
  if (growthPct === null || growthPct === undefined) return null;
  const raw = 50 + growthPct / coefficient;
  return Math.max(0, Math.min(100, raw));
}

const NOT_SCORED: Omit<UrlScoreResult, "state"> = {
  clickScore: null,
  impressionScore: null,
  score: null,
  weight: 0,
};

/**
 * Score one URL for one range. Pure — the repository layer joins the inputs.
 *
 * "excluded" / "no_data" / "new_grace" all produce the same outcome (not
 * counted); they differ only in the reason, which the admin UI surfaces so a
 * score can be explained rather than just asserted.
 */
export function computeUrlScore(input: UrlScoreInput, settings: KpiSettings): UrlScoreResult {
  if (input.kpiExcluded) {
    return { state: "excluded", ...NOT_SCORED };
  }
  if (input.dataStatus !== "ok") {
    return { state: "no_data", ...NOT_SCORED };
  }
  if (input.growthStatus === "new_signal") {
    // No previous period to compare against. Rather than inventing an absolute
    // target to grade it on, a new URL is simply NOT counted — neither credit
    // nor penalty — during the grace period. It becomes "normal" on its own at
    // the next refresh, once the cache has a previous period to compare with.
    // A URL first worked after the comparison window had already closed cannot
    // have a baseline in it — no configured grace length changes that, because
    // the shortfall scales with the range (3M needs ~93 days, 6M ~182), not with
    // a fixed constant. Measuring against previous_end_date is exact where a day
    // count is only an approximation.
    const bornAfterBaseline =
      input.workedAt !== null && input.previousEndDate !== null && input.workedAt > input.previousEndDate;
    const age = input.workedAt ? daysBetween(input.workedAt, input.endDate) : 0;

    if (bornAfterBaseline || age < settings.newUrlGraceDays) {
      return { state: "new_grace", ...NOT_SCORED };
    }
    // Old enough, existed while the window was open, and still recorded nothing
    // then. There is genuinely no baseline to compare against — it must not be
    // graded as if it had stalled.
    return { state: "no_data", ...NOT_SCORED };
  }

  const coefficient = settings.coefficient[input.projectType] ?? settings.coefficient.growth;
  const clickScore = clampScore(input.clickGrowthPct, coefficient);
  const impressionScore = clampScore(input.impressionGrowthPct, coefficient);

  if (clickScore === null && impressionScore === null) {
    return { state: "no_data", ...NOT_SCORED };
  }

  // With only one of the two available, use it alone rather than folding the
  // missing side in as 0 — that would silently punish a URL for a gap in data.
  const score =
    clickScore !== null && impressionScore !== null
      ? clickScore * settings.clickWeight + impressionScore * settings.impressionWeight
      : (clickScore ?? impressionScore)!;

  const weight = (Number(input.previousImpressions ?? 0) + Number(input.currentImpressions ?? 0)) / 2;

  return { state: "normal", clickScore, impressionScore, score, weight };
}

export interface ScoreAggregate {
  kpiScore: number | null;
  eligibleUrlCount: number;
  normalUrlCount: number;
  newGraceUrlCount: number;
  excludedUrlCount: number;
  noDataUrlCount: number;
  cappedUrlCount: number;
  totalWeight: number;
}

/**
 * Traffic-weighted mean over the "normal" URLs, with a per-URL weight ceiling so
 * a single URL cannot dominate a member's score — the same risk the clamp
 * handles for one freak URL, but on the weight side (e.g. a member with two
 * URLs where one carries 95% of the traffic).
 *
 * The cap is single-pass — it does not renormalize repeatedly. Simple and good
 * enough for v1; with very few URLs and extreme traffic skew the effective share
 * can still exceed the nominal cap. Stated here so nobody is surprised by it.
 */
export function aggregateScore(results: UrlScoreResult[], urlWeightCapPct: number): ScoreAggregate {
  const normal = results.filter((r) => r.state === "normal");
  const counts = {
    eligibleUrlCount: normal.length,
    normalUrlCount: normal.length,
    newGraceUrlCount: results.filter((r) => r.state === "new_grace").length,
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
