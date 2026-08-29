// Type-only, so nothing is imported at runtime: the verify scripts load this
// module directly in plain Node, where the tsconfig "@/" alias does not exist
// and a value import would fail to resolve. Node erases the statement entirely.
import type { UrlContribution } from "@/lib/performance/score";

/**
 * Stamped onto every warning row and part of its idempotency key. Bump it when a
 * rule changes shape, so a re-evaluation writes a new warning beside the old one
 * instead of rewriting history — that pair is what a backtest compares.
 */
export const WARNING_RULE_VERSION = "warning-v1";

/** Stamped onto audits and audit events, for the same reason. */
export const AUDIT_POLICY_VERSION = "audit-policy-v1";

export type WarningLevel = "early_warning" | "mandatory_audit";

/** The two ranges warnings are defined on. 6M has no rule of its own. */
export type WarningRangeKey = "last_1_month" | "last_3_months";

export interface WarningThresholds {
  /** Minimum click decline, in percent, before a 1M warning can fire. */
  clickDropPct: number;
  /** Absolute clicks lost floor, so a 3-to-1 URL does not warn on a 66% drop. */
  minClickLoss: number;
  /** A URL must be scoring below this to warn at all. */
  urlScoreCeiling: number;
  dragPoints1m: number;
  dragPoints3m: number;
  /** How many consecutive closed-month evaluations escalate a warning to a mandatory audit. */
  consecutiveMonths: number;
  auditSlaDays: number;
  exposureEscalationPct: number;
}

export interface WarningCandidate {
  rangeKey: WarningRangeKey;
  /** seo_performance_cache.data_status — anything but "ok" is not evidence of anything. */
  dataStatus: string;
  score: number | null;
  currentClicks: number | null;
  /** What the score was graded against: the robust baseline, or the raw previous period. */
  baselineClicks: number | null;
  /** KPI points this URL takes off this member, from urlContributions. */
  dragPoints: number;
  /** consecutive_count of the same (URL, member, range) warning last closed month; 0 if none. */
  priorConsecutiveCount: number;
}

export interface WarningVerdict {
  level: WarningLevel;
  consecutiveCount: number;
}

/**
 * How far clicks fell against the baseline, as a positive percentage.
 *
 * Null when there is no baseline to fall from — a URL going from nothing to
 * nothing has not declined, and dividing by zero to say so would invent a
 * warning out of an absence of data.
 */
export function clickDropPct(current: number | null, baseline: number | null): number | null {
  const base = Number(baseline ?? 0);
  if (!Number.isFinite(base) || base <= 0) return null;
  return ((base - Number(current ?? 0)) / base) * 100;
}

/** Clicks actually lost. The scale check the percentage on its own cannot make. */
export function clickLoss(current: number | null, baseline: number | null): number {
  return Math.max(0, Number(baseline ?? 0) - Number(current ?? 0));
}

/**
 * Whether one URL warrants a warning for one member in one range.
 *
 * Every condition is an AND, and impact is one of them: a URL can be down 80%
 * and still not warn if it carries too little of the member's traffic to move
 * their KPI. That is the point — the queue has to be short enough to actually
 * work through, and the URLs worth working through are the ones costing points.
 *
 * Deliberately not triggered by the "stable ±1%" growth label: it is far too
 * sensitive and blind to scale, which is how a warning system becomes noise
 * everyone learns to ignore.
 *
 * A warning is a request to look, never a change to a score. Nothing this
 * function returns can move a KPI, in this phase or a later one.
 */
export function evaluateWarning(
  candidate: WarningCandidate,
  thresholds: WarningThresholds,
): WarningVerdict | null {
  // A URL with no comparable data has not declined; it is unmeasured. Warning on
  // it would put the queue's biggest volume where its evidence is weakest.
  if (candidate.dataStatus !== "ok") return null;
  if (candidate.score === null) return null;
  if (candidate.score >= thresholds.urlScoreCeiling) return null;

  if (candidate.rangeKey === "last_3_months") {
    // Sustained, material drag over a quarter is itself the trigger — no drop
    // percentage needed, because three months of mediocrity costs a member the
    // same points as one sharp fall and is more likely to be actionable.
    if (candidate.dragPoints < thresholds.dragPoints3m) return null;
    return { level: "mandatory_audit", consecutiveCount: candidate.priorConsecutiveCount + 1 };
  }

  const dropPct = clickDropPct(candidate.currentClicks, candidate.baselineClicks);
  if (dropPct === null || dropPct < thresholds.clickDropPct) return null;
  if (clickLoss(candidate.currentClicks, candidate.baselineClicks) < thresholds.minClickLoss) return null;
  if (candidate.dragPoints < thresholds.dragPoints1m) return null;

  // Recurrence is the escalation, and it is counted in closed months. Counting it
  // in refreshes would let a fortnight of daily runs look like a fortnight of
  // consecutive periods when the windows overlap by ~97%.
  const consecutiveCount = candidate.priorConsecutiveCount + 1;
  return {
    level: consecutiveCount >= thresholds.consecutiveMonths ? "mandatory_audit" : "early_warning",
    consecutiveCount,
  };
}

/**
 * Share of a member's KPI that is currently sitting behind an unresolved audit.
 *
 * Null rather than 0 when there is no weight to divide by: "no exposure" and "no
 * basis to measure exposure" are different answers, and a dashboard that renders
 * the second as 0% is quietly reassuring.
 *
 * The adjustment-side exposures (adjustment uplift, adjusted and
 * external-adjusted exposure) are deliberately absent — they measure the effect
 * of adjustments, and Giai đoạn 1 creates none.
 */
export function pendingAuditExposure(
  contributions: UrlContribution[],
  isPending: (contribution: UrlContribution) => boolean,
): number | null {
  const total = contributions.reduce((sum, c) => sum + c.cappedWeight, 0);
  if (total <= 0) return null;
  const pending = contributions.filter(isPending).reduce((sum, c) => sum + c.cappedWeight, 0);
  return pending / total;
}

/**
 * Total KPI points a member is currently losing to URLs scoring below neutral.
 * The number that decides whose queue gets worked first.
 */
export function totalDragPoints(contributions: UrlContribution[]): number {
  return contributions.reduce((sum, c) => sum + c.dragPoints, 0);
}
