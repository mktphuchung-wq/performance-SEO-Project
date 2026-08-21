/**
 * Layer 3 — the one number a member is evaluated on.
 *
 *   Layer 1  URL       clicks + impressions      → URL Score      (score.ts)
 *   Layer 2  MEMBER×RANGE  the member's URLs     → 1M / 3M / 6M   (score.ts + refresh)
 *   Layer 3  OFFICIAL KPI  1M/3M/6M × weights    → Official KPI   (this file)
 *
 * Nothing here re-reads a raw metric. Clicks and impressions already went
 * through Layer 1; adding a growth bonus back on top at Layer 3 would count the
 * same movement twice. The only inputs are the three period scores.
 *
 * Trend runs beside the KPI on the same three inputs and never enters the
 * formula — it explains the number, it does not adjust it. A member whose recent
 * months improved already scores higher through their 1M; paying them for the
 * direction as well would be a second reward for one piece of work.
 */

export type TrendState = "improving" | "declining" | "recovering" | "cooling" | "stable" | "insufficient_data";

/** The three scoreable ranges, newest first — the order trend reads them in. */
export const KPI_PERIOD_KEYS = ["last_1_month", "last_3_months", "last_6_months"] as const;

export type KpiPeriodKey = (typeof KPI_PERIOD_KEYS)[number];

export type KpiPeriodWeights = Record<KpiPeriodKey, number>;

/**
 * Team default. 3M carries the most because it is the period where SEO work has
 * had time to show but is still describing now: 1M reacts fastest and is the
 * noisiest, 6M proves durability but drags old results into a current
 * assessment. Both flank the anchor at half its weight.
 */
export const MEMBER_KPI_WEIGHTS: KpiPeriodWeights = {
  last_1_month: 0.25,
  last_3_months: 0.5,
  last_6_months: 0.25,
};

/** Points two period scores must differ by before the gap is read as a direction. */
export const DEFAULT_TREND_TOLERANCE = 5;

export type KpiStrategy = "balanced" | "momentum" | "sustainability" | "custom";

/**
 * Named mixes for the per-member strategy. Every preset still sums to 1, so all
 * members are scored on the same 0–100 scale — what changes is which period the
 * scale is measured over, not how generous it is.
 *
 * - balanced        — the team default; 3M anchors.
 * - momentum        — for a turnaround or a new site: recent movement is the job.
 * - sustainability  — for an established site: holding the level is the job.
 */
export const KPI_STRATEGY_PRESETS: Record<Exclude<KpiStrategy, "custom">, KpiPeriodWeights> = {
  balanced: MEMBER_KPI_WEIGHTS,
  momentum: { last_1_month: 0.5, last_3_months: 0.35, last_6_months: 0.15 },
  sustainability: { last_1_month: 0.15, last_3_months: 0.35, last_6_months: 0.5 },
};

export interface PeriodScores {
  score1m: number | null;
  score3m: number | null;
  score6m: number | null;
}

export interface OfficialKpiResult {
  /** 0–100, or null when nothing weighted has data. Never 0 as a stand-in for null. */
  officialKpi: number | null;
  /** Periods that have a score at all — what "based on N of 3 periods" reports. */
  availablePeriodCount: number;
  /** Periods that actually moved the number: has a score AND carries weight. */
  contributingPeriodCount: number;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scoresAsPeriods(scores: PeriodScores): Array<{ key: KpiPeriodKey; score: number | null }> {
  return [
    { key: "last_1_month", score: scores.score1m },
    { key: "last_3_months", score: scores.score3m },
    { key: "last_6_months", score: scores.score6m },
  ];
}

/**
 * Weighted mean of the periods that have a score, renormalized over the weight
 * those periods carry.
 *
 * A missing period is NOT a zero. Scoring 78/72/null as `78×.25 + 72×.50 + 0×.25`
 * would report 55.5 for a member whose two measured periods both sit in the
 * seventies — the missing 6M would read as a catastrophic half-year. Dividing by
 * the weight that was actually available (75, not 100) keeps the number on the
 * same scale as a member with all three, and the coverage is reported beside it
 * so a thin basis is visible rather than hidden.
 *
 * A period whose weight is 0 contributes nothing by definition — that is what
 * the member's strategy asked for. If every period with data has zero weight the
 * result is null, not an invented fallback: the strategy says those months do
 * not count, so there is nothing to report.
 */
export function computeOfficialKpi(scores: PeriodScores, weights: KpiPeriodWeights = MEMBER_KPI_WEIGHTS): OfficialKpiResult {
  const periods = scoresAsPeriods(scores);
  const withScore = periods.filter((p) => p.score !== null);

  let weightedSum = 0;
  let availableWeight = 0;
  let contributingPeriodCount = 0;

  for (const period of withScore) {
    const weight = Math.max(0, Number(weights[period.key]) || 0);
    if (weight === 0) continue;
    weightedSum += (period.score as number) * weight;
    availableWeight += weight;
    contributingPeriodCount += 1;
  }

  const officialKpi =
    availableWeight > 0 ? roundTo(Math.max(0, Math.min(100, weightedSum / availableWeight)), 2) : null;

  return { officialKpi, availablePeriodCount: withScore.length, contributingPeriodCount };
}

export interface TrendInput extends PeriodScores {
  tolerance?: number;
}

/**
 * Direction of travel, read from the same three scores — diagnostic only.
 *
 * With all three periods the shape of the curve is what separates the states:
 * whether the recent leg moved, and whether the older leg agrees with it.
 * Improving and Recovering both have a rising recent leg; they differ in where
 * it is rising from, which is exactly the difference between "still climbing"
 * and "climbing back". Cooling and Declining split the same way going down.
 *
 * With only two periods there is one leg and no shape, so only the direction is
 * claimed — Recovering and Cooling need a middle point and are never guessed at.
 */
export function computeTrend({ score1m, score3m, score6m, tolerance = DEFAULT_TREND_TOLERANCE }: TrendInput): TrendState {
  const t = Math.max(0, Number(tolerance) || 0);
  const present = scoresAsPeriods({ score1m, score3m, score6m }).filter((p) => p.score !== null);

  if (present.length < 2) return "insufficient_data";

  if (score1m !== null && score3m !== null && score6m !== null) {
    const recentUp = score1m > score3m + t;
    const recentDown = score1m < score3m - t;
    // The older leg, 6M → 3M. "Down" means the middle period sits meaningfully
    // below the half-year — the dip that makes a rise a recovery.
    const olderUp = score3m > score6m + t;
    const olderDown = score3m < score6m - t;

    if (recentUp) return olderDown ? "recovering" : "improving";
    if (recentDown) return olderUp ? "cooling" : "declining";
    return "stable";
  }

  // Two periods: `present` is already newest-first, so [0] is the later window.
  const recent = present[0].score as number;
  const older = present[1].score as number;
  if (recent > older + t) return "improving";
  if (recent < older - t) return "declining";
  return "stable";
}

export interface MemberCompositeScoreInput extends PeriodScores {
  memberName: string;
  memberEmail: string | null;
}

export interface MemberCompositeKpi extends MemberCompositeScoreInput {
  officialKpi: number | null;
  availablePeriodCount: number;
  contributingPeriodCount: number;
  trend: TrendState;
  /** The mix this member's KPI was actually computed with. */
  weights: KpiPeriodWeights;
  strategy: KpiStrategy;
  /** True when the row used a per-member override rather than the team default. */
  hasCustomWeights: boolean;
}

export interface CompositeKpiOptions {
  defaultWeights?: KpiPeriodWeights;
  tolerance?: number;
  /** Per-member overrides, keyed by member_name exactly as the score rows are. */
  weightsByMember?: Map<string, { weights: KpiPeriodWeights; strategy: KpiStrategy }>;
}

export function buildMemberCompositeKpi(
  input: MemberCompositeScoreInput,
  options: CompositeKpiOptions = {},
): MemberCompositeKpi {
  const defaults = options.defaultWeights ?? MEMBER_KPI_WEIGHTS;
  const override = options.weightsByMember?.get(input.memberName);
  const weights = override?.weights ?? defaults;

  return {
    ...input,
    ...computeOfficialKpi(input, weights),
    // Trend is deliberately computed from the raw periods with no weighting:
    // it describes what happened, which does not change with how a member
    // chose to be graded.
    trend: computeTrend({ ...input, tolerance: options.tolerance ?? DEFAULT_TREND_TOLERANCE }),
    weights,
    strategy: override?.strategy ?? strategyForWeights(weights),
    hasCustomWeights: Boolean(override),
  };
}

export function buildMemberCompositeKpis(
  inputs: MemberCompositeScoreInput[],
  options: CompositeKpiOptions = {},
): MemberCompositeKpi[] {
  return inputs.map((input) => buildMemberCompositeKpi(input, options));
}

/**
 * Team average over the members who have a KPI. A member with no score is left
 * out rather than folded in as 0 — work that has not become measurable yet is
 * not failed work, and averaging it as zero would punish the whole team for it.
 */
export function averageOfficialKpi(rows: Array<{ officialKpi: number | null }>): number | null {
  const scored = rows.filter((row) => row.officialKpi !== null);
  if (scored.length === 0) return null;
  return roundTo(scored.reduce((sum, row) => sum + (row.officialKpi as number), 0) / scored.length, 2);
}

// ------------------------------------------------------------------- weights

const WEIGHT_EPSILON = 1e-6;

export function weightsSum(weights: KpiPeriodWeights): number {
  return KPI_PERIOD_KEYS.reduce((sum, key) => sum + (Number(weights[key]) || 0), 0);
}

/** Human-readable reason the mix is unusable, or null when it is fine. */
export function validateWeights(weights: KpiPeriodWeights): string | null {
  for (const key of KPI_PERIOD_KEYS) {
    const value = Number(weights[key]);
    if (!Number.isFinite(value)) return `${key} must be a number`;
    if (value < 0) return `${key} must not be negative`;
    if (value > 1) return `${key} must be at most 1`;
  }
  const sum = weightsSum(weights);
  if (sum <= 0) return "at least one period must carry weight";
  if (Math.abs(sum - 1) > WEIGHT_EPSILON) {
    return `weights must add up to 1 (currently ${roundTo(sum, 4)})`;
  }
  return null;
}

/**
 * Scale a mix so it sums to 1, so the UI can accept "50 / 30 / 30" and store
 * something the score stays on a 0–100 scale with. Rounding is applied to the
 * two flanks and the anchor absorbs the remainder, so the stored numbers add up
 * exactly rather than to 0.9999.
 */
export function normalizeWeights(weights: KpiPeriodWeights): KpiPeriodWeights {
  const sum = weightsSum(weights);
  if (!(sum > 0)) return { ...MEMBER_KPI_WEIGHTS };

  const w1 = roundTo(Math.max(0, Number(weights.last_1_month) || 0) / sum, 4);
  const w6 = roundTo(Math.max(0, Number(weights.last_6_months) || 0) / sum, 4);
  return { last_1_month: w1, last_3_months: roundTo(1 - w1 - w6, 4), last_6_months: w6 };
}

function sameWeights(a: KpiPeriodWeights, b: KpiPeriodWeights): boolean {
  return KPI_PERIOD_KEYS.every((key) => Math.abs((Number(a[key]) || 0) - (Number(b[key]) || 0)) < WEIGHT_EPSILON);
}

/** The preset a mix corresponds to, or "custom" when it matches none of them. */
export function strategyForWeights(weights: KpiPeriodWeights): KpiStrategy {
  for (const [strategy, preset] of Object.entries(KPI_STRATEGY_PRESETS)) {
    if (sameWeights(weights, preset)) return strategy as KpiStrategy;
  }
  return "custom";
}

/** "25% 1M · 50% 3M · 25% 6M" — the formula line shown under the KPI. */
export function formatWeightMix(weights: KpiPeriodWeights): string {
  return `${weightPct(weights.last_1_month)}% 1M · ${weightPct(weights.last_3_months)}% 3M · ${weightPct(
    weights.last_6_months,
  )}% 6M`;
}

/** Weights are stored as fractions; every control and label shows percentages. */
export function weightPct(weight: number): number {
  return roundTo((Number(weight) || 0) * 100, 1);
}
