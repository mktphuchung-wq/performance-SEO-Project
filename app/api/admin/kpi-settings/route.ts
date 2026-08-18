import { NextResponse } from "next/server";
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
  for (const key of ["coefficient_new", "coefficient_growth", "coefficient_stable"] as const) {
    if (!(merged[key] > 0)) return `${key} must be greater than 0`;
  }
  if (!Number.isInteger(merged.new_url_grace_days) || merged.new_url_grace_days < 0) {
    return "new_url_grace_days must be an integer of 0 or more";
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
