import { query } from "@/lib/db";
import type { GrowthResult } from "@/lib/performance/growth";
import type { RangeKey } from "@/lib/ranges";

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

export async function upsertPerformanceCache(input: UpsertPerformanceCacheInput): Promise<void> {
  const g = input.growth;
  await query(
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
       updated_at = now()`,
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
    ],
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
}

export async function listPerformanceByMemberEmail(email: string, rangeKey: RangeKey): Promise<UrlPerformanceRow[]> {
  return query<UrlPerformanceRow>(
    `select c.id, c.id as content_url_id, p.range_key, p.start_date, p.end_date,
            p.clicks, p.impressions, p.ctr, p.position,
            p.click_delta, p.click_growth_pct, p.impression_delta, p.impression_growth_pct,
            p.growth_status, p.data_status, p.error_message, p.refreshed_at,
            c.project, c.url, c.member_name, c.member_email, c.work_type
     from public.content_urls c
     join public.seo_performance_cache p on p.content_url_id = c.id and p.range_key = $2
     where c.is_active = true and lower(c.member_email) = lower($1)
     order by p.clicks desc nulls last`,
    [email, rangeKey],
  );
}

export async function listPerformanceAll(rangeKey: RangeKey, filters: { project?: string; memberName?: string }): Promise<UrlPerformanceRow[]> {
  const conditions = ["c.is_active = true", "p.range_key = $1"];
  const params: unknown[] = [rangeKey];

  if (filters.project) {
    params.push(filters.project);
    conditions.push(`c.project = $${params.length}`);
  }
  if (filters.memberName) {
    params.push(filters.memberName);
    conditions.push(`c.member_name = $${params.length}`);
  }

  return query<UrlPerformanceRow>(
    `select c.id, c.id as content_url_id, p.range_key, p.start_date, p.end_date,
            p.clicks, p.impressions, p.ctr, p.position,
            p.click_delta, p.click_growth_pct, p.impression_delta, p.impression_growth_pct,
            p.growth_status, p.data_status, p.error_message, p.refreshed_at,
            c.project, c.url, c.member_name, c.member_email, c.work_type
     from public.content_urls c
     join public.seo_performance_cache p on p.content_url_id = c.id
     where ${conditions.join(" and ")}
     order by p.clicks desc nulls last`,
    params,
  );
}

export async function getPerformanceForContentUrl(contentUrlId: string): Promise<UrlPerformanceRow[]> {
  return query<UrlPerformanceRow>(
    `select c.id, c.id as content_url_id, p.range_key, p.start_date, p.end_date,
            p.clicks, p.impressions, p.ctr, p.position,
            p.click_delta, p.click_growth_pct, p.impression_delta, p.impression_growth_pct,
            p.growth_status, p.data_status, p.error_message, p.refreshed_at,
            c.project, c.url, c.member_name, c.member_email, c.work_type
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

export async function getPerformanceRowsForRange(rangeKey: RangeKey): Promise<
  Array<{
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
  }>
> {
  return query(
    `select p.content_url_id, c.project, c.member_name, c.member_email,
            p.clicks, p.impressions, p.ctr, p.position,
            p.previous_clicks, p.previous_impressions, p.growth_status, p.data_status
     from public.seo_performance_cache p
     join public.content_urls c on c.id = p.content_url_id
     where p.range_key = $1 and c.is_active = true`,
    [rangeKey],
  );
}
