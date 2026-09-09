import { query, type DbExecutor } from "@/lib/db";
import { getSyncBulkChunkSize } from "@/lib/env";
import type { GrowthResult } from "@/lib/performance/growth";
import type { RangeKey } from "@/lib/ranges";
import { memberAttributionPredicate } from "@/lib/repositories/content-url-works";

export interface UpsertPerformanceCacheInput {
  contentUrlId: string;
  rangeKey: RangeKey;
  startDate: string;
  endDate: string;
  previousStartDate: string | null;
  previousEndDate: string | null;
  growth: GrowthResult;
  errorMessage?: string | null;
}

export async function upsertPerformanceCache(input: UpsertPerformanceCacheInput, db?: DbExecutor): Promise<void> {
  const g = input.growth;
  const sql =
    `insert into public.seo_performance_cache
       (content_url_id, range_key, start_date, end_date, previous_start_date, previous_end_date,
        clicks, impressions, ctr, position, previous_clicks, previous_impressions, previous_ctr, previous_position,
        click_delta, click_growth_pct, impression_delta, impression_growth_pct, growth_status, data_status,
        error_message, refreshed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, now(), now())
     on conflict (content_url_id, range_key) do update set
       start_date = excluded.start_date,
       end_date = excluded.end_date,
       previous_start_date = excluded.previous_start_date,
       previous_end_date = excluded.previous_end_date,
       clicks = excluded.clicks,
       impressions = excluded.impressions,
       ctr = excluded.ctr,
       position = excluded.position,
       previous_clicks = excluded.previous_clicks,
       previous_impressions = excluded.previous_impressions,
       previous_ctr = excluded.previous_ctr,
       previous_position = excluded.previous_position,
       click_delta = excluded.click_delta,
       click_growth_pct = excluded.click_growth_pct,
       impression_delta = excluded.impression_delta,
       impression_growth_pct = excluded.impression_growth_pct,
       growth_status = excluded.growth_status,
       data_status = excluded.data_status,
       error_message = excluded.error_message,
       refreshed_at = now(),
       updated_at = now()`;
  const params =
    [
      input.contentUrlId,
      input.rangeKey,
      input.startDate,
      input.endDate,
      input.previousStartDate,
      input.previousEndDate,
      g.clicks,
      g.impressions,
      g.ctr,
      g.position,
      g.previousClicks,
      g.previousImpressions,
      g.previousCtr,
      g.previousPosition,
      g.clickDelta,
      g.clickGrowthPct,
      g.impressionDelta,
      g.impressionGrowthPct,
      g.growthStatus,
      g.dataStatus,
      input.errorMessage ?? null,
    ];
  if (db) await db.query(sql, params);
  else await query(sql, params);
}

export async function bulkUpsertPerformanceCache(inputs: UpsertPerformanceCacheInput[], db?: DbExecutor): Promise<void> {
  if (inputs.length === 0) return;
  const payload = inputs.map((input) => ({
    content_url_id: input.contentUrlId,
    range_key: input.rangeKey,
    start_date: input.startDate,
    end_date: input.endDate,
    previous_start_date: input.previousStartDate,
    previous_end_date: input.previousEndDate,
    clicks: input.growth.clicks,
    impressions: input.growth.impressions,
    ctr: input.growth.ctr,
    position: input.growth.position,
    previous_clicks: input.growth.previousClicks,
    previous_impressions: input.growth.previousImpressions,
    previous_ctr: input.growth.previousCtr,
    previous_position: input.growth.previousPosition,
    click_delta: input.growth.clickDelta,
    click_growth_pct: input.growth.clickGrowthPct,
    impression_delta: input.growth.impressionDelta,
    impression_growth_pct: input.growth.impressionGrowthPct,
    growth_status: input.growth.growthStatus,
    data_status: input.growth.dataStatus,
    error_message: input.errorMessage ?? null,
  }));
  const sql = `insert into public.seo_performance_cache
      (content_url_id, range_key, start_date, end_date, previous_start_date, previous_end_date,
       clicks, impressions, ctr, position, previous_clicks, previous_impressions, previous_ctr, previous_position,
       click_delta, click_growth_pct, impression_delta, impression_growth_pct, growth_status, data_status,
       error_message, refreshed_at, updated_at)
    select x.content_url_id, x.range_key, x.start_date, x.end_date, x.previous_start_date, x.previous_end_date,
           x.clicks, x.impressions, x.ctr, x.position, x.previous_clicks, x.previous_impressions,
           x.previous_ctr, x.previous_position, x.click_delta, x.click_growth_pct, x.impression_delta,
           x.impression_growth_pct, x.growth_status, x.data_status, x.error_message, now(), now()
    from jsonb_to_recordset($1::jsonb) as x(
      content_url_id uuid, range_key text, start_date date, end_date date, previous_start_date date,
      previous_end_date date, clicks numeric, impressions numeric, ctr numeric, position numeric,
      previous_clicks numeric, previous_impressions numeric, previous_ctr numeric, previous_position numeric,
      click_delta numeric, click_growth_pct numeric, impression_delta numeric, impression_growth_pct numeric,
      growth_status text, data_status text, error_message text
    )
    on conflict (content_url_id, range_key) do update set
      start_date = excluded.start_date, end_date = excluded.end_date,
      previous_start_date = excluded.previous_start_date, previous_end_date = excluded.previous_end_date,
      clicks = excluded.clicks, impressions = excluded.impressions, ctr = excluded.ctr, position = excluded.position,
      previous_clicks = excluded.previous_clicks, previous_impressions = excluded.previous_impressions,
      previous_ctr = excluded.previous_ctr, previous_position = excluded.previous_position,
      click_delta = excluded.click_delta, click_growth_pct = excluded.click_growth_pct,
      impression_delta = excluded.impression_delta, impression_growth_pct = excluded.impression_growth_pct,
      growth_status = excluded.growth_status, data_status = excluded.data_status,
      error_message = excluded.error_message, refreshed_at = now(), updated_at = now()`;
  if (db) await db.query(sql, [JSON.stringify(payload)]);
  else await query(sql, [JSON.stringify(payload)]);
}

export async function bulkStagePerformanceCache(
  refreshRunId: string,
  inputs: UpsertPerformanceCacheInput[],
  db?: DbExecutor,
): Promise<void> {
  if (inputs.length === 0) return;
  const toPayload = (rows: UpsertPerformanceCacheInput[]) => rows.map((input) => ({
    refresh_run_id: refreshRunId,
    content_url_id: input.contentUrlId,
    range_key: input.rangeKey,
    start_date: input.startDate,
    end_date: input.endDate,
    previous_start_date: input.previousStartDate,
    previous_end_date: input.previousEndDate,
    clicks: input.growth.clicks,
    impressions: input.growth.impressions,
    ctr: input.growth.ctr,
    position: input.growth.position,
    previous_clicks: input.growth.previousClicks,
    previous_impressions: input.growth.previousImpressions,
    previous_ctr: input.growth.previousCtr,
    previous_position: input.growth.previousPosition,
    click_delta: input.growth.clickDelta,
    click_growth_pct: input.growth.clickGrowthPct,
    impression_delta: input.growth.impressionDelta,
    impression_growth_pct: input.growth.impressionGrowthPct,
    growth_status: input.growth.growthStatus,
    data_status: input.growth.dataStatus,
    error_message: input.errorMessage ?? null,
  }));
  const sql = `insert into public.seo_performance_cache_stage
      (refresh_run_id, content_url_id, range_key, start_date, end_date, previous_start_date, previous_end_date,
       clicks, impressions, ctr, position, previous_clicks, previous_impressions, previous_ctr, previous_position,
       click_delta, click_growth_pct, impression_delta, impression_growth_pct, growth_status, data_status,
       error_message, updated_at)
    select x.refresh_run_id, x.content_url_id, x.range_key, x.start_date, x.end_date,
           x.previous_start_date, x.previous_end_date, x.clicks, x.impressions, x.ctr, x.position,
           x.previous_clicks, x.previous_impressions, x.previous_ctr, x.previous_position,
           x.click_delta, x.click_growth_pct, x.impression_delta, x.impression_growth_pct,
           x.growth_status, x.data_status, x.error_message, now()
    from jsonb_to_recordset($1::jsonb) as x(
      refresh_run_id uuid, content_url_id uuid, range_key text, start_date date, end_date date,
      previous_start_date date, previous_end_date date, clicks numeric, impressions numeric,
      ctr numeric, position numeric, previous_clicks numeric, previous_impressions numeric,
      previous_ctr numeric, previous_position numeric, click_delta numeric, click_growth_pct numeric,
      impression_delta numeric, impression_growth_pct numeric, growth_status text, data_status text,
      error_message text
    )
    on conflict (refresh_run_id, content_url_id) do update set
      clicks = excluded.clicks, impressions = excluded.impressions, ctr = excluded.ctr, position = excluded.position,
      previous_clicks = excluded.previous_clicks, previous_impressions = excluded.previous_impressions,
      previous_ctr = excluded.previous_ctr, previous_position = excluded.previous_position,
      click_delta = excluded.click_delta, click_growth_pct = excluded.click_growth_pct,
      impression_delta = excluded.impression_delta, impression_growth_pct = excluded.impression_growth_pct,
      growth_status = excluded.growth_status, data_status = excluded.data_status,
      error_message = excluded.error_message, updated_at = now()`;
  const chunkSize = getSyncBulkChunkSize();
  for (let offset = 0; offset < inputs.length; offset += chunkSize) {
    const params = [JSON.stringify(toPayload(inputs.slice(offset, offset + chunkSize)))];
    if (db) await db.query(sql, params);
    else await query(sql, params);
  }
}

export async function getStagedPerformanceCount(refreshRunId: string, db?: DbExecutor): Promise<number> {
  const sql = "select count(*)::int as count from public.seo_performance_cache_stage where refresh_run_id = $1";
  const rows = db ? (await db.query<{ count: number }>(sql, [refreshRunId])).rows : await query<{ count: number }>(sql, [refreshRunId]);
  return rows[0]?.count ?? 0;
}

export async function publishStagedPerformanceCache(refreshRunId: string, db: DbExecutor): Promise<void> {
  await db.query(
    `insert into public.seo_performance_cache
       (content_url_id, range_key, start_date, end_date, previous_start_date, previous_end_date,
        clicks, impressions, ctr, position, previous_clicks, previous_impressions, previous_ctr, previous_position,
        click_delta, click_growth_pct, impression_delta, impression_growth_pct, growth_status, data_status,
        error_message, published_refresh_run_id, refreshed_at, updated_at)
     select content_url_id, range_key, start_date, end_date, previous_start_date, previous_end_date,
            clicks, impressions, ctr, position, previous_clicks, previous_impressions, previous_ctr, previous_position,
            click_delta, click_growth_pct, impression_delta, impression_growth_pct, growth_status, data_status,
            error_message, $2, now(), now()
     from public.seo_performance_cache_stage where refresh_run_id = $1
     on conflict (content_url_id, range_key) do update set
       start_date = excluded.start_date, end_date = excluded.end_date,
       previous_start_date = excluded.previous_start_date, previous_end_date = excluded.previous_end_date,
       clicks = excluded.clicks, impressions = excluded.impressions, ctr = excluded.ctr, position = excluded.position,
       previous_clicks = excluded.previous_clicks, previous_impressions = excluded.previous_impressions,
       previous_ctr = excluded.previous_ctr, previous_position = excluded.previous_position,
       click_delta = excluded.click_delta, click_growth_pct = excluded.click_growth_pct,
       impression_delta = excluded.impression_delta, impression_growth_pct = excluded.impression_growth_pct,
       growth_status = excluded.growth_status, data_status = excluded.data_status,
       error_message = excluded.error_message, published_refresh_run_id = excluded.published_refresh_run_id,
       refreshed_at = now(), updated_at = now()`,
    [refreshRunId, refreshRunId],
  );
}

export interface UrlPerformanceRow {
  id: string;
  content_url_id: string;
  range_key: string;
  start_date: string;
  end_date: string;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
  previous_clicks: number | null;
  previous_impressions: number | null;
  previous_ctr: number | null;
  previous_position: number | null;
  click_delta: number | null;
  click_growth_pct: number | null;
  impression_delta: number | null;
  impression_growth_pct: number | null;
  growth_status: string;
  data_status: string;
  error_message: string | null;
  refreshed_at: string;
  project: string;
  url: string;
  member_name: string;
  member_email: string | null;
  work_type: string;
  /** The earliest work event on the URL — when the team started working on it. */
  first_worked_at: string | null;
  /** The most recent work event on the URL. */
  worked_at: string | null;
  published_at: string | null;
  /**
   * Work events on this URL inside the period being looked at. 0 means nobody
   * touched it in the period, so its traffic counts for its current owner rather
   * than for anyone who worked it. Null when no period was supplied.
   */
  period_work_count: number | null;
  kpi_excluded: boolean;
  kpi_excluded_reason: string | null;
}

/** The columns every URL listing shares, so the three queries cannot drift apart. */
const URL_PERFORMANCE_COLUMNS = `c.id, c.id as content_url_id, p.range_key, p.start_date, p.end_date,
            p.clicks, p.impressions, p.ctr, p.position,
            p.previous_clicks, p.previous_impressions, p.previous_ctr, p.previous_position,
            p.click_delta, p.click_growth_pct, p.impression_delta, p.impression_growth_pct,
            p.growth_status, p.data_status, p.error_message, p.refreshed_at,
            c.project, c.url, c.member_name, c.member_email, c.work_type,
            c.first_worked_at, c.worked_at, c.published_at,
            c.kpi_excluded, c.kpi_excluded_reason`;

export async function listPerformanceByMemberEmail(email: string, rangeKey: RangeKey): Promise<UrlPerformanceRow[]> {
  return query<UrlPerformanceRow>(
    `select ${URL_PERFORMANCE_COLUMNS}, null::int as period_work_count
     from public.content_urls c
     join public.seo_performance_cache p on p.content_url_id = c.id and p.range_key = $2
     where c.is_active = true and lower(c.member_email) = lower($1)
     order by p.clicks desc nulls last`,
    [email, rangeKey],
  );
}

export interface PerformanceListFilters {
  project?: string;
  memberName?: string;
  /** The period the listing is about. Both dates or neither. */
  startDate?: string;
  endDate?: string;
  /** Drop URLs with no work event in the period instead of listing them all. */
  workedInPeriodOnly?: boolean;
}

/**
 * Every URL with its cached metrics, filtered the way the period says.
 *
 * Metrics always come from the `range_key` cache — that is the only window
 * Search Console data exists for. `startDate`/`endDate` say which URLs the
 * listing is *about*, which is a different question: a member filter with a
 * period applies the same attribution rule the KPI scoring uses
 * (`memberAttributionPredicate`), so picking a person and a month answers "what
 * did they work on that month", not "what do they currently own". Without a
 * period there is nothing to attribute against, so ownership is all that is left.
 */
export async function listPerformanceAll(
  rangeKey: RangeKey,
  filters: PerformanceListFilters,
): Promise<UrlPerformanceRow[]> {
  const conditions = ["c.is_active = true", "p.range_key = $1"];
  const params: unknown[] = [rangeKey];
  const hasPeriod = Boolean(filters.startDate && filters.endDate);

  let startParam = "";
  let endParam = "";
  if (hasPeriod) {
    params.push(filters.startDate, filters.endDate);
    startParam = `$${params.length - 1}`;
    endParam = `$${params.length}`;
  }

  if (filters.project) {
    params.push(filters.project);
    conditions.push(`c.project = $${params.length}`);
  }
  if (filters.memberName) {
    params.push(filters.memberName);
    const memberParam = `$${params.length}`;
    conditions.push(
      hasPeriod
        ? memberAttributionPredicate("c.id", startParam, endParam, memberParam)
        : `c.member_name = ${memberParam}`,
    );
  }
  if (hasPeriod && filters.workedInPeriodOnly) {
    conditions.push(`exists (select 1 from public.content_url_works w
       where w.content_url_id = c.id and w.is_active = true
         and w.worked_at between ${startParam} and ${endParam})`);
  }

  const periodWorkCount = hasPeriod
    ? `(select count(*)::int from public.content_url_works w
        where w.content_url_id = c.id and w.is_active = true
          and w.worked_at between ${startParam} and ${endParam})`
    : "null::int";

  return query<UrlPerformanceRow>(
    `select ${URL_PERFORMANCE_COLUMNS}, ${periodWorkCount} as period_work_count
     from public.content_urls c
     join public.seo_performance_cache p on p.content_url_id = c.id
     where ${conditions.join(" and ")}
     order by p.clicks desc nulls last`,
    params,
  );
}

export async function getPerformanceForContentUrl(contentUrlId: string): Promise<UrlPerformanceRow[]> {
  return query<UrlPerformanceRow>(
    `select ${URL_PERFORMANCE_COLUMNS}, null::int as period_work_count
     from public.seo_performance_cache p
     join public.content_urls c on c.id = p.content_url_id
     where p.content_url_id = $1
     order by p.range_key`,
    [contentUrlId],
  );
}

export interface RangeFreshness {
  range_key: string;
  refreshed_at: string | null;
  start_date: string | null;
  end_date: string | null;
  cached_urls: number;
  ok_urls: number;
  error_urls: number;
}

interface PerformanceAggregateRow {
  content_url_id: string;
  project: string;
  member_name: string;
  member_email: string | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
  previous_clicks: number | null;
  previous_impressions: number | null;
  growth_status: string;
  data_status: string;
}

/**
 * How current each range's cached data is. The dashboard reads Postgres, never
 * GSC, so this is what tells a user whether what they're looking at is stale
 * rather than absent.
 */
export async function getRangeFreshness(): Promise<RangeFreshness[]> {
  return query<RangeFreshness>(
    `select p.range_key,
            max(p.refreshed_at) as refreshed_at,
            max(p.start_date) as start_date,
            max(p.end_date) as end_date,
            count(*)::int as cached_urls,
            count(*) filter (where p.data_status = 'ok')::int as ok_urls,
            count(*) filter (where p.data_status = 'error')::int as error_urls
     from public.seo_performance_cache p
     join public.content_urls c on c.id = p.content_url_id and c.is_active = true
     group by p.range_key`,
  );
}

export async function getPerformanceRowsForRange(rangeKey: RangeKey, db?: DbExecutor): Promise<PerformanceAggregateRow[]> {
  const sql = `select p.content_url_id, c.project, c.member_name, c.member_email,
             p.clicks, p.impressions, p.ctr, p.position,
             p.previous_clicks, p.previous_impressions, p.growth_status, p.data_status
      from public.seo_performance_cache p
      join public.content_urls c on c.id = p.content_url_id
      where p.range_key = $1 and c.is_active = true`;
  return db ? (await db.query<PerformanceAggregateRow>(sql, [rangeKey])).rows : query<PerformanceAggregateRow>(sql, [rangeKey]);
}
