import type { ContentReviewCriterion } from "@/lib/repositories/content-review";

/**
 * One task quality figure, on the same rule the SQL in recomputeBatch() uses:
 * only criteria that actually carry a grade take part, and a task with no grade
 * at all is null rather than 0.
 *
 * This exists so the review grid can show a row updating as it is graded without
 * a round trip per keystroke. The server stays the source of truth for anything
 * stored — the batch totals shown next to it come from the API response, not
 * from here.
 */
export function taskQualityPct(
  scores: Map<string, number>,
  criteriaById: Map<string, ContentReviewCriterion>,
): number | null {
  let weighted = 0;
  let weightSum = 0;

  for (const [criteriaId, score] of scores) {
    const criterion = criteriaById.get(criteriaId);
    if (!criterion) continue;
    const weight = Number(criterion.weight);
    weighted += (score / 10) * weight;
    weightSum += weight;
  }

  if (weightSum <= 0) return null;
  return (weighted / weightSum) * 100;
}
