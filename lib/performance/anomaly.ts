export type AnomalyStatus = "none" | "provisional" | "confirmed" | "dismissed";
export type AnomalyDirection = "spike" | "drop";

export interface AnomalySettings {
  zscoreThreshold: number;
  ratioThreshold: number;
  minHistoryMonths: number;
}

export interface AnomalyVerdict {
  direction: AnomalyDirection | null;
  zscore: number | null;
}

const NOT_ANOMALOUS: AnomalyVerdict = { direction: null, zscore: null };

/** 0.6745 is the 75th percentile of the standard normal — what puts a MAD-based score on the same scale as a z-score. */
const MAD_TO_SIGMA = 0.6745;

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Is this month so far off the URL's own history that using it as next month's
 * yardstick would be wrong?
 *
 * Median and MAD rather than mean and standard deviation: the value under test is
 * itself an outlier candidate, and a mean/stddev pair is dragged towards it, so a
 * big enough spike hides itself. Median and MAD are not.
 *
 * Both conditions must hold. The z-score alone fires far too eagerly on quiet
 * URLs — a page sitting at 2, 2, 2 clicks has a MAD of 0, so any change at all is
 * infinitely many deviations out. The ratio gate is what says "and it actually
 * moved by a meaningful multiple", which is the part that matters for a score.
 */
export function detectAnomaly(
  currentValue: number,
  trailingSamples: number[],
  settings: AnomalySettings,
): AnomalyVerdict {
  if (trailingSamples.length < settings.minHistoryMonths) return NOT_ANOMALOUS;

  const center = median(trailingSamples);
  // Nothing to deviate from: a URL with no history of traffic has no normal yet.
  if (center <= 0) return NOT_ANOMALOUS;

  const mad = median(trailingSamples.map((value) => Math.abs(value - center)));
  const ratio = currentValue / center;
  const foldChange = Math.max(ratio, ratio > 0 ? 1 / ratio : Infinity);
  if (foldChange <= settings.ratioThreshold) return NOT_ANOMALOUS;

  // MAD of 0 means every historical month was identical. The ratio gate above
  // already established the move is large, so treat it as unbounded deviation
  // rather than dividing by zero.
  const zscore = mad === 0 ? Infinity : (MAD_TO_SIGMA * (currentValue - center)) / mad;
  if (Math.abs(zscore) <= settings.zscoreThreshold) return NOT_ANOMALOUS;

  return {
    direction: currentValue > center ? "spike" : "drop",
    zscore: Number.isFinite(zscore) ? zscore : null,
  };
}

/**
 * A flag raised on arrival cannot yet tell a one-off blip from a step change to a
 * new normal — both look identical the month they happen. The month *after*
 * settles it: if traffic came back to where it was, the flagged month was a blip
 * and stays out of baselines; if the new level held, it was real growth and the
 * month rejoins them.
 *
 * Without this the detector would permanently discount every genuine step up in
 * a URL's traffic, which would understate the very people it is meant to protect.
 */
export function reconcileAnomaly(
  flaggedValue: number,
  nextValue: number,
  preAnomalyCenter: number,
  settings: AnomalySettings,
): Extract<AnomalyStatus, "confirmed" | "dismissed"> {
  const distanceToOldNormal = foldChangeBetween(nextValue, preAnomalyCenter);
  const distanceToFlagged = foldChangeBetween(nextValue, flaggedValue);
  // Ties go to "confirmed": the flagged month is the one we already know is
  // unusual, so ambiguity should not hand it back its influence over scoring.
  return distanceToOldNormal <= distanceToFlagged ? "confirmed" : "dismissed";
}

function foldChangeBetween(a: number, b: number): number {
  const smoothedA = a + 1;
  const smoothedB = b + 1;
  return Math.max(smoothedA / smoothedB, smoothedB / smoothedA);
}
