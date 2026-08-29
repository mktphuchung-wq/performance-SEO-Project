import { query, type DbExecutor } from "@/lib/db";
import { getSyncBulkChunkSize } from "@/lib/env";
import type { AnomalyDirection, AnomalyStatus } from "@/lib/performance/anomaly";

export type ManualOverride = "force_exclude" | "force_include";

export interface MonthlyMetricRow {
  content_url_id: string;
  period_start: string;
  period_end: string;
  clicks: number | null;
  impressions: number | null;
  data_status: string;
  anomaly_status: AnomalyStatus;
  anomaly_direction: AnomalyDirection | null;
  anomaly_zscore: number | null;
  manual_override: ManualOverride | null;
  manual_override_reason: string | null;
}

export interface UpsertMonthlyMetricInput {
  contentUrlId: string;
  periodStart: string;
  periodEnd: string;
  clicks: number | null;
  impressions: number | null;
  dataStatus: string;
}

/**
 * Whether a month may be used as (part of) a baseline.
 *
 * An admin's call always wins — that is the whole point of the override, and it
 * is what lets someone rescue a month the detector got wrong without waiting for
 * the reconciliation pass. Otherwise a month is out while it is flagged, and back
 * in once reconciliation dismissed the flag.
 */
export function isBaselineEligible(row: Pick<MonthlyMetricRow, "data_status" | "anomaly_status" | "manual_override">): boolean {
  if (row.manual_override === "force_exclude") return false;
  if (row.manual_override === "force_include") return row.data_status === "ok";
  if (row.data_status !== "ok") return false;
  return row.anomaly_status !== "provisional" && row.anomaly_status !== "confirmed";
}

/**
 * Measurements only — never touches the anomaly or override columns, so
 * re-running a snapshot for a month cannot silently un-flag it or throw away an
 * admin's decision.
 */
export async function bulkUpsertMonthlyMetrics(inputs: UpsertMonthlyMetricInput[], db?: DbExecutor): Promise<void> {
  if (inputs.length === 0) return;
  const sql = `insert into public.content_url_monthly_metrics
      (content_url_id, period_start, period_end, clicks, impressions, data_status, refreshed_at, updated_at)
    select x.content_url_id, x.period_start, x.period_end, x.clicks, x.impressions, x.data_status, now(), now()
    from jsonb_to_recordset($1::jsonb) as x(
      content_url_id uuid, period_start date, period_end date,
      clicks numeric, impressions numeric, data_status text
    )
    on conflict (content_url_id, period_start) do update set
      period_end = excluded.period_end,
      clicks = excluded.clicks,
      impressions = excluded.impressions,
      data_status = excluded.data_status,
      refreshed_at = now(),
      updated_at = now()`;
  const chunkSize = getSyncBulkChunkSize();
  for (let offset = 0; offset < inputs.length; offset += chunkSize) {
    const payload = inputs.slice(offset, offset + chunkSize).map((input) => ({
      content_url_id: input.contentUrlId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      clicks: input.clicks,
      impressions: input.impressions,
      data_status: input.dataStatus,
    }));
    const params = [JSON.stringify(payload)];
    if (db) await db.query(sql, params);
    else await query(sql, params);
  }
}

/**
 * Every month strictly before `beforeDate`, newest first, for the given URLs.
 * Flagged and overridden months come back too — the caller decides what to do
 * with them, and the detector needs the unfiltered series to judge a new month
 * against.
 */
export async function getMonthlyHistoryForUrls(
  contentUrlIds: string[],
  beforeDate: string,
  monthsBack: number,
  db?: DbExecutor,
): Promise<Map<string, MonthlyMetricRow[]>> {
  if (contentUrlIds.length === 0 || monthsBack < 1) return new Map();
  const sql = `select content_url_id, period_start, period_end, clicks, impressions, data_status,
                      anomaly_status, anomaly_direction, anomaly_zscore, manual_override, manual_override_reason
                 from public.content_url_monthly_metrics
                where content_url_id = any($1::uuid[])
                  and period_start < $2::date
                  and period_start >= ($2::date - make_interval(months => $3))
                order by content_url_id, period_start desc`;
  const params = [contentUrlIds, beforeDate, monthsBack];
  const rows = db ? (await db.query<MonthlyMetricRow>(sql, params)).rows : await query<MonthlyMetricRow>(sql, params);

  const index = new Map<string, MonthlyMetricRow[]>();
  for (const row of rows) {
    const existing = index.get(row.content_url_id);
    if (existing) existing.push(row);
    else index.set(row.content_url_id, [row]);
  }
  return index;
}

export interface AnomalyFlagInput {
  contentUrlId: string;
  periodStart: string;
  status: AnomalyStatus;
  direction: AnomalyDirection | null;
  zscore: number | null;
}

export async function bulkSetAnomalyFlags(inputs: AnomalyFlagInput[], db?: DbExecutor): Promise<void> {
  if (inputs.length === 0) return;
  const sql = `update public.content_url_monthly_metrics m set
      anomaly_status = x.anomaly_status,
      anomaly_direction = x.anomaly_direction,
      anomaly_zscore = x.anomaly_zscore,
      anomaly_detected_at = case when x.anomaly_status = 'provisional' then now() else m.anomaly_detected_at end,
      anomaly_resolved_at = case when x.anomaly_status in ('confirmed', 'dismissed') then now() else null end,
      updated_at = now()
    from jsonb_to_recordset($1::jsonb) as x(
      content_url_id uuid, period_start date, anomaly_status text,
      anomaly_direction text, anomaly_zscore numeric
    )
    where m.content_url_id = x.content_url_id and m.period_start = x.period_start`;
  const chunkSize = getSyncBulkChunkSize();
  for (let offset = 0; offset < inputs.length; offset += chunkSize) {
    const payload = inputs.slice(offset, offset + chunkSize).map((input) => ({
      content_url_id: input.contentUrlId,
      period_start: input.periodStart,
      anomaly_status: input.status,
      anomaly_direction: input.direction,
      anomaly_zscore: input.zscore,
    }));
    const params = [JSON.stringify(payload)];
    if (db) await db.query(sql, params);
    else await query(sql, params);
  }
}

export async function listMonthlyMetricsForUrl(contentUrlId: string, limit = 24): Promise<MonthlyMetricRow[]> {
  return query<MonthlyMetricRow>(
    `select content_url_id, period_start, period_end, clicks, impressions, data_status,
            anomaly_status, anomaly_direction, anomaly_zscore, manual_override, manual_override_reason
       from public.content_url_monthly_metrics
      where content_url_id = $1
      order by period_start desc
      limit $2`,
    [contentUrlId, limit],
  );
}

/**
 * An admin overriding the detector, in either direction. Passing null clears the
 * override and hands the month back to whatever the detector decided.
 */
export async function setMonthlyManualOverride(
  contentUrlId: string,
  periodStart: string,
  override: ManualOverride | null,
  reason: string | null,
  actor: string | null,
): Promise<void> {
  await query(
    `update public.content_url_monthly_metrics set
       manual_override = $3,
       manual_override_reason = case when $3::text is null then null else $4 end,
       manual_override_by = case when $3::text is null then null else $5 end,
       manual_override_at = case when $3::text is null then null else now() end,
       updated_at = now()
     where content_url_id = $1 and period_start = $2::date`,
    [contentUrlId, periodStart, override, reason, actor],
  );
}
