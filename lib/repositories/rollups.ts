import { query, type DbExecutor } from "@/lib/db";
import type { RangeKey } from "@/lib/ranges";

export interface RollupInput {
  key: string; // member_name or project
  rangeKey: RangeKey;
  startDate: string;
  endDate: string;
  urlCount: number;
  urlsWithData: number;
  growingUrls: number;
  stableUrls: number;
  decliningUrls: number;
  noDataUrls: number;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  // Null when the range has no previous period to compare against — not 0.
  previousClicks: number | null;
  previousImpressions: number | null;
  clickDelta: number | null;
  clickGrowthPct: number | null;
  impressionDelta: number | null;
  impressionGrowthPct: number | null;
}

export async function upsertMemberRollup(memberEmail: string | null, input: RollupInput, db?: DbExecutor): Promise<void> {
  const sql =
    `insert into public.member_performance_rollup
       (member_name, member_email, range_key, start_date, end_date, url_count, urls_with_data,
        growing_urls, stable_urls, declining_urls, no_data_urls, clicks, impressions, ctr, position,
        previous_clicks, previous_impressions, click_delta, click_growth_pct, impression_delta, impression_growth_pct,
        refreshed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, now(), now())
     on conflict (member_name, range_key) do update set
       member_email = excluded.member_email,
       start_date = excluded.start_date,
       end_date = excluded.end_date,
       url_count = excluded.url_count,
       urls_with_data = excluded.urls_with_data,
       growing_urls = excluded.growing_urls,
       stable_urls = excluded.stable_urls,
       declining_urls = excluded.declining_urls,
       no_data_urls = excluded.no_data_urls,
       clicks = excluded.clicks,
       impressions = excluded.impressions,
       ctr = excluded.ctr,
       position = excluded.position,
       previous_clicks = excluded.previous_clicks,
       previous_impressions = excluded.previous_impressions,
       click_delta = excluded.click_delta,
       click_growth_pct = excluded.click_growth_pct,
       impression_delta = excluded.impression_delta,
       impression_growth_pct = excluded.impression_growth_pct,
       refreshed_at = now(),
       updated_at = now()`;
  const params = [
      input.key,
      memberEmail,
      input.rangeKey,
      input.startDate,
      input.endDate,
      input.urlCount,
      input.urlsWithData,
      input.growingUrls,
      input.stableUrls,
      input.decliningUrls,
      input.noDataUrls,
      input.clicks,
      input.impressions,
      input.ctr,
      input.position,
      input.previousClicks,
      input.previousImpressions,
      input.clickDelta,
      input.clickGrowthPct,
      input.impressionDelta,
      input.impressionGrowthPct,
     ];
  if (db) await db.query(sql, params);
  else await query(sql, params);
}

export async function upsertProjectRollup(input: RollupInput, db?: DbExecutor): Promise<void> {
  const sql =
    `insert into public.project_performance_rollup
       (project, range_key, start_date, end_date, url_count, urls_with_data,
        growing_urls, stable_urls, declining_urls, no_data_urls, clicks, impressions, ctr, position,
        previous_clicks, previous_impressions, click_delta, click_growth_pct, impression_delta, impression_growth_pct,
        refreshed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now(), now())
     on conflict (project, range_key) do update set
       start_date = excluded.start_date,
       end_date = excluded.end_date,
       url_count = excluded.url_count,
       urls_with_data = excluded.urls_with_data,
       growing_urls = excluded.growing_urls,
       stable_urls = excluded.stable_urls,
       declining_urls = excluded.declining_urls,
       no_data_urls = excluded.no_data_urls,
       clicks = excluded.clicks,
       impressions = excluded.impressions,
       ctr = excluded.ctr,
       position = excluded.position,
       previous_clicks = excluded.previous_clicks,
       previous_impressions = excluded.previous_impressions,
       click_delta = excluded.click_delta,
       click_growth_pct = excluded.click_growth_pct,
       impression_delta = excluded.impression_delta,
       impression_growth_pct = excluded.impression_growth_pct,
       refreshed_at = now(),
       updated_at = now()`;
  const params = [
      input.key,
      input.rangeKey,
      input.startDate,
      input.endDate,
      input.urlCount,
      input.urlsWithData,
      input.growingUrls,
      input.stableUrls,
      input.decliningUrls,
      input.noDataUrls,
      input.clicks,
      input.impressions,
      input.ctr,
      input.position,
      input.previousClicks,
      input.previousImpressions,
      input.clickDelta,
      input.clickGrowthPct,
      input.impressionDelta,
      input.impressionGrowthPct,
     ];
  if (db) await db.query(sql, params);
  else await query(sql, params);
}

/** Columns every rollup table shares; the member/project keys are added on top. */
export interface RollupMetrics {
  range_key: string;
  start_date: string;
  end_date: string;
  url_count: number;
  urls_with_data: number;
  growing_urls: number;
  stable_urls: number;
  declining_urls: number;
  no_data_urls: number;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  previous_clicks: number | null;
  previous_impressions: number | null;
  click_delta: number | null;
  click_growth_pct: number | null;
  impression_delta: number | null;
  impression_growth_pct: number | null;
  refreshed_at: string;
}

export interface MemberRollupRow extends RollupMetrics {
  member_name: string;
  member_email: string | null;
}

export async function listMemberRollups(rangeKey: RangeKey): Promise<MemberRollupRow[]> {
  return query<MemberRollupRow>(
    "select * from public.member_performance_rollup where range_key = $1 order by clicks desc",
    [rangeKey],
  );
}

export async function getMemberRollupByEmail(email: string, rangeKey: RangeKey): Promise<MemberRollupRow | null> {
  const rows = await query<MemberRollupRow>(
    "select * from public.member_performance_rollup where range_key = $1 and lower(member_email) = lower($2)",
    [rangeKey, email],
  );
  return rows[0] ?? null;
}

export interface ProjectRollupRow extends RollupMetrics {
  project: string;
}

export async function listProjectRollups(rangeKey: RangeKey): Promise<ProjectRollupRow[]> {
  return query<ProjectRollupRow>(
    "select * from public.project_performance_rollup where range_key = $1 order by clicks desc",
    [rangeKey],
  );
}
