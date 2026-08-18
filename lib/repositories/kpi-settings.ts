import { query, queryOne } from "@/lib/db";
import type { KpiSettings } from "@/lib/performance/score";

export interface KpiSettingsRow {
  coefficient_new: number;
  coefficient_growth: number;
  coefficient_stable: number;
  new_url_grace_days: number;
  click_weight: number;
  impression_weight: number;
  url_weight_cap_pct: number;
}

/**
 * The only columns an update may touch. Column names cannot be parameterized in
 * SQL, so they are interpolated into the statement — an allowlist is what keeps
 * a request body from naming an arbitrary column (or arbitrary SQL) here.
 */
export const KPI_SETTINGS_COLUMNS = [
  "coefficient_new",
  "coefficient_growth",
  "coefficient_stable",
  "new_url_grace_days",
  "click_weight",
  "impression_weight",
  "url_weight_cap_pct",
] as const;

export type KpiSettingsColumn = (typeof KPI_SETTINGS_COLUMNS)[number];

export async function getKpiSettings(): Promise<KpiSettings> {
  const row = await queryOne<KpiSettingsRow>("select * from public.kpi_settings where id = 1");
  if (!row) throw new Error("kpi_settings row missing — did migration 004 run?");
  return {
    coefficient: {
      new: Number(row.coefficient_new),
      growth: Number(row.coefficient_growth),
      stable: Number(row.coefficient_stable),
    },
    newUrlGraceDays: Number(row.new_url_grace_days),
    clickWeight: Number(row.click_weight),
    impressionWeight: Number(row.impression_weight),
    urlWeightCapPct: Number(row.url_weight_cap_pct),
  };
}

export async function getKpiSettingsRow(): Promise<KpiSettingsRow> {
  const row = await queryOne<KpiSettingsRow>("select * from public.kpi_settings where id = 1");
  if (!row) throw new Error("kpi_settings row missing — did migration 004 run?");
  return row;
}

/**
 * Updates only the fields supplied, leaving the rest at their current values.
 * Unknown keys are ignored rather than trusted.
 */
export async function updateKpiSettings(input: Partial<Record<KpiSettingsColumn, number>>): Promise<void> {
  const entries = KPI_SETTINGS_COLUMNS.filter(
    (column) => input[column] !== undefined && input[column] !== null,
  ).map((column) => [column, input[column]] as const);

  if (entries.length === 0) return;

  const setClause = entries.map(([column], i) => `${column} = $${i + 1}`).join(", ");
  const values = entries.map(([, value]) => value);
  await query(`update public.kpi_settings set ${setClause}, updated_at = now() where id = 1`, values);
}
