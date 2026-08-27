import { query, queryOne, type DbExecutor } from "@/lib/db";
import type { KpiPeriodWeights } from "@/lib/performance/composite-score";
import type { KpiSettings } from "@/lib/performance/score";

export interface KpiSettingsRow {
  target_growth_pct_new: number;
  target_growth_pct_growth: number;
  target_growth_pct_stable: number;
  smoothing_constant: number;
  click_weight: number;
  impression_weight: number;
  url_weight_cap_pct: number;
  kpi_weight_1m: number;
  kpi_weight_3m: number;
  kpi_weight_6m: number;
  trend_tolerance: number;
}

/**
 * The only columns an update may touch. Column names cannot be parameterized in
 * SQL, so they are interpolated into the statement — an allowlist is what keeps
 * a request body from naming an arbitrary column (or arbitrary SQL) here.
 */
export const KPI_SETTINGS_COLUMNS = [
  "target_growth_pct_new",
  "target_growth_pct_growth",
  "target_growth_pct_stable",
  "smoothing_constant",
  "click_weight",
  "impression_weight",
  "url_weight_cap_pct",
  "kpi_weight_1m",
  "kpi_weight_3m",
  "kpi_weight_6m",
  "trend_tolerance",
] as const;

export type KpiSettingsColumn = (typeof KPI_SETTINGS_COLUMNS)[number];

export async function getKpiSettings(db?: DbExecutor): Promise<KpiSettings> {
  const row = await getKpiSettingsRow(db);
  return {
    targetGrowthPct: {
      new: Number(row.target_growth_pct_new),
      growth: Number(row.target_growth_pct_growth),
      stable: Number(row.target_growth_pct_stable),
    },
    smoothingConstant: Number(row.smoothing_constant),
    clickWeight: Number(row.click_weight),
    impressionWeight: Number(row.impression_weight),
    urlWeightCapPct: Number(row.url_weight_cap_pct),
  };
}

export interface CompositeKpiSettings {
  /** Team default mix, used for every member without a personal strategy. */
  defaultWeights: KpiPeriodWeights;
  trendTolerance: number;
}

/**
 * Layer 3's half of the settings row. Kept apart from `getKpiSettings()` because
 * they answer different questions: that one tunes how a URL is graded, this one
 * how the three period scores are combined. Nothing in Layer 1 reads these.
 */
export async function getCompositeKpiSettings(): Promise<CompositeKpiSettings> {
  const row = await getKpiSettingsRow();
  return {
    defaultWeights: {
      last_1_month: Number(row.kpi_weight_1m),
      last_3_months: Number(row.kpi_weight_3m),
      last_6_months: Number(row.kpi_weight_6m),
    },
    trendTolerance: Number(row.trend_tolerance),
  };
}

export async function getKpiSettingsRow(db?: DbExecutor): Promise<KpiSettingsRow> {
  const row = db
    ? (await db.query<KpiSettingsRow>("select * from public.kpi_settings where id = 1")).rows[0] ?? null
    : await queryOne<KpiSettingsRow>("select * from public.kpi_settings where id = 1");
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
