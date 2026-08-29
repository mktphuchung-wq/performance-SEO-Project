import { NextResponse } from "next/server";
import { validateWeights } from "@/lib/performance/composite-score";
import {
  KPI_SETTINGS_COLUMNS,
  getKpiSettingsRow,
  updateKpiSettings,
  type KpiSettingsColumn,
  type KpiSettingsRow,
} from "@/lib/repositories/kpi-settings";

export async function GET() {
  return NextResponse.json({ settings: await getKpiSettingsRow() });
}

/**
 * Validates the merged result, not just the submitted fields — click_weight and
 * impression_weight have to sum to 1, and a request that changes only one of
 * them is still only valid against whatever the other one currently is.
 */
function validate(merged: KpiSettingsRow): string | null {
  // A target of 0 makes log2(1 + 0/100) = 0, and the sensitivity it feeds
  // divides by exactly that — so 0 is rejected here as well as in the schema.
  for (const key of ["target_growth_pct_new", "target_growth_pct_growth", "target_growth_pct_stable"] as const) {
    if (!(merged[key] > 0)) return `${key} must be greater than 0`;
  }
  if (!(merged.smoothing_constant > 0)) {
    return "smoothing_constant must be greater than 0";
  }
  for (const key of ["click_weight", "impression_weight"] as const) {
    if (!(merged[key] >= 0 && merged[key] <= 1)) return `${key} must be between 0 and 1`;
  }
  if (Math.abs(merged.click_weight + merged.impression_weight - 1) > 1e-9) {
    return "click_weight and impression_weight must add up to 1";
  }
  if (!(merged.url_weight_cap_pct > 0 && merged.url_weight_cap_pct <= 100)) {
    return "url_weight_cap_pct must be greater than 0 and at most 100";
  }
  // Layer 3: the team default period mix has to stay on the 0–100 scale, which
  // is what summing to 1 buys. The same rule the database check enforces.
  const weightError = validateWeights({
    last_1_month: merged.kpi_weight_1m,
    last_3_months: merged.kpi_weight_3m,
    last_6_months: merged.kpi_weight_6m,
  });
  if (weightError) return `Official KPI period weights — ${weightError}`;
  if (!(merged.trend_tolerance >= 0 && merged.trend_tolerance <= 50)) {
    return "trend_tolerance must be between 0 and 50";
  }
  if (!Number.isInteger(merged.baseline_lookback_periods)
    || merged.baseline_lookback_periods < 1 || merged.baseline_lookback_periods > 12) {
    return "baseline_lookback_periods must be a whole number between 1 and 12";
  }
  // At 1 every sample collapses onto the median, which would throw away the
  // variation the baseline is supposed to average over.
  if (!(merged.baseline_winsorize_multiple > 1)) {
    return "baseline_winsorize_multiple must be greater than 1";
  }
  if (!(merged.anomaly_zscore_threshold > 0)) {
    return "anomaly_zscore_threshold must be greater than 0";
  }
  // At or below 1 every month is "at least 1x its own median", so every month
  // would be an anomaly.
  if (!(merged.anomaly_ratio_threshold > 1)) {
    return "anomaly_ratio_threshold must be greater than 1";
  }
  if (!Number.isInteger(merged.anomaly_min_history_months) || merged.anomaly_min_history_months < 2) {
    return "anomaly_min_history_months must be a whole number of at least 2";
  }
  // Warning thresholds. All experimental starting values by design — the point of
  // making them settings is that they get backtested and retuned, so the only
  // rules here are the ones that keep a rule meaningful at all.
  if (!(merged.warning_click_drop_pct > 0 && merged.warning_click_drop_pct < 100)) {
    // 0 would warn on every URL that merely failed to grow; 100 could never fire.
    return "warning_click_drop_pct must be greater than 0 and less than 100";
  }
  if (!(merged.warning_min_click_loss >= 0)) {
    return "warning_min_click_loss cannot be negative";
  }
  if (!(merged.warning_url_score_ceiling > 0 && merged.warning_url_score_ceiling <= 100)) {
    return "warning_url_score_ceiling must be between 0 and 100";
  }
  for (const key of ["warning_drag_points_1m", "warning_drag_points_3m"] as const) {
    if (!(merged[key] >= 0)) return `${key} cannot be negative`;
  }
  // "Two consecutive periods" needs at least two to be a streak rather than a
  // restatement of the single-period rule.
  if (!Number.isInteger(merged.warning_consecutive_months) || merged.warning_consecutive_months < 2) {
    return "warning_consecutive_months must be a whole number of at least 2";
  }
  if (!Number.isInteger(merged.audit_sla_days) || merged.audit_sla_days < 1) {
    return "audit_sla_days must be a whole number of at least 1";
  }
  if (!(merged.audit_exposure_escalation_pct > 0 && merged.audit_exposure_escalation_pct <= 100)) {
    return "audit_exposure_escalation_pct must be greater than 0 and at most 100";
  }
  return null;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const patch: Partial<Record<KpiSettingsColumn, number>> = {};
  for (const column of KPI_SETTINGS_COLUMNS) {
    const raw = (body as Record<string, unknown>)[column];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return NextResponse.json({ error: `${column} must be a number` }, { status: 400 });
    }
    patch[column] = value;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No recognised settings supplied" }, { status: 400 });
  }

  const current = await getKpiSettingsRow();
  const error = validate({ ...current, ...patch });
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  await updateKpiSettings(patch);
  return NextResponse.json({ ok: true, settings: await getKpiSettingsRow() });
}
