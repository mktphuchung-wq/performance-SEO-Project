"use client";

import { Badge } from "@/components/ui";
import {
  DIRECTION_ADJUSTMENT_LABELS,
  formatGrowthPct,
  formatScore,
  formatWeightPct,
} from "@/lib/format";

export interface ScoreAdjustment {
  kpi_score: number | null;
  base_kpi_score: number | null;
  click_component_score: number | null;
  impression_component_score: number | null;
  effective_click_weight: number | null;
  effective_impression_weight: number | null;
  direction_adjustment: string;
  opposite_sign_factor: number | null;
  formula_version: string;
}

/**
 * The configured weights this row was adjusted away from, read back out of the
 * row itself.
 *
 * The effective pair is the configured pair with one side multiplied by d and
 * both renormalized, so the ratio between them still carries the original ratio
 * — divide the factor back out and, because the configured weights sum to 1 (a
 * database constraint since migration 015), the pair is recoverable. That saves
 * every table that shows this badge from fetching kpi_settings just to say what
 * the weights used to be, and it shows what the row was actually graded against
 * rather than what the settings happen to say today.
 */
function baseWeightsOf(adjustment: ScoreAdjustment): { clickWeight: number; impressionWeight: number } | null {
  const ewc = adjustment.effective_click_weight;
  const ewi = adjustment.effective_impression_weight;
  const factor = adjustment.opposite_sign_factor;
  if (ewc === null || ewi === null || !factor || ewi === 0 || ewc === 0) return null;

  const ratio =
    adjustment.direction_adjustment === "click_up_impression_down"
      ? (Number(ewc) / Number(ewi)) * Number(factor)
      : Number(ewc) / Number(ewi) / Number(factor);
  const clickWeight = ratio / (1 + ratio);
  return { clickWeight, impressionWeight: 1 - clickWeight };
}

/**
 * The marker on a member score whose Click and Impression moved against each
 * other, and the whole arithmetic behind it in the tooltip.
 *
 * Members only — a project is always scored on the configured weights, and the
 * project views never pass this component anything. The explanation is the point
 * of the badge: a score that silently differed from the 70/30 blend everyone
 * learned to expect would be worse than no adjustment at all, so the base score,
 * both component scores, both growth percentages and both weight pairs travel
 * with it.
 */
export function ScoreAdjustmentBadge({
  adjustment,
  clickGrowthPct,
  impressionGrowthPct,
}: {
  adjustment: ScoreAdjustment;
  clickGrowthPct?: number | null;
  impressionGrowthPct?: number | null;
}) {
  if (adjustment.direction_adjustment === "none" || adjustment.kpi_score === null) return null;

  const label = DIRECTION_ADJUSTMENT_LABELS[adjustment.direction_adjustment] ?? adjustment.direction_adjustment;
  const base = baseWeightsOf(adjustment);
  const lines = [
    `${label} — the declining metric keeps ${adjustment.opposite_sign_factor ?? 0.5}× of its weight.`,
    `Score ${formatScore(adjustment.base_kpi_score)} → ${formatScore(adjustment.kpi_score)}`,
    `Click ${formatGrowthPct(clickGrowthPct)} · Impression ${formatGrowthPct(impressionGrowthPct)}`,
    `Components — Click ${formatScore(adjustment.click_component_score)} · Impression ${formatScore(adjustment.impression_component_score)}`,
    `Weights — Click ${formatWeightPct(base?.clickWeight)} → ${formatWeightPct(adjustment.effective_click_weight)} · Impression ${formatWeightPct(base?.impressionWeight)} → ${formatWeightPct(adjustment.effective_impression_weight)}`,
    `Formula ${adjustment.formula_version}`,
  ];

  return (
    <span title={lines.join("\n")}>
      <Badge tone="warning">{label}</Badge>
    </span>
  );
}
