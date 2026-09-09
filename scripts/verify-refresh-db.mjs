import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(projectDir);

if (!process.env.DATABASE_URL) {
  console.log("Refresh DB verification skipped: DATABASE_URL is not configured.");
  process.exit(0);
}

const migrations = await Promise.all(["010_refresh_range_reliability.sql", "016_refresh_publish_guard.sql", "017_refresh_publication_lineage.sql"].map(async (file) => {
  const migrationPath = path.join(projectDir, "migrations", file);
  return (await readFile(migrationPath, "utf8"))
    .replace(/^\s*begin;\s*/i, "")
    .replace(/\s*commit;\s*$/i, "");
}));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
const { publishStagedPerformanceCache, upsertPerformanceCache } = await import("@/lib/repositories/performance-cache");

try {
  await client.query("begin");
  await client.query(migrations.join("\n"));
  const result = await client.query(`
    select
      to_regclass('public.refresh_run_items') is not null as has_items,
      to_regclass('public.seo_performance_cache_stage') is not null as has_stage,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'refresh_runs' and column_name = 'phase'
      ) as has_phase,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'refresh_runs' and column_name = 'published'
      ) as has_published,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'seo_performance_cache' and column_name = 'published_refresh_run_id'
      ) as has_published_lineage
  `);
  const checks = result.rows[0];
  if (!checks?.has_items || !checks?.has_stage || !checks?.has_phase || !checks?.has_published || !checks?.has_published_lineage) throw new Error("Refresh migration schema checks failed");
  const arrayCast = await client.query(`
    select cardinality(content_url_ids) as count
    from jsonb_to_recordset('[{"content_url_ids":["00000000-0000-0000-0000-000000000001"]}]'::jsonb)
      as x(content_url_ids uuid[])
  `);
  if (arrayCast.rows[0]?.count !== 1) throw new Error("Refresh item UUID array conversion failed");

  const fixtureKey = `verify-refresh-publish-${Date.now()}`;
  const { rows: [contentUrl] } = await client.query(
    `insert into public.content_urls (url_hash, project, url, member_name, gsc_property)
     values ($1, 'Refresh verification', $2, 'Verifier', 'https://verify.example/')
     returning id`,
    [fixtureKey, `https://verify.example/${fixtureKey}`],
  );
  const { rows: [refreshRun] } = await client.query(
    `insert into public.refresh_runs
       (status, phase, range_key, start_date, end_date, previous_start_date, previous_end_date,
        total_urls, total_items, pending_content_url_ids, heartbeat_at)
     values ('running', 'publishing', 'last_1_month', date '2026-08-01', date '2026-08-31',
             date '2026-07-01', date '2026-07-31', 1, 1, '{}', now())
     returning id`,
  );
  await client.query(
    `insert into public.seo_performance_cache_stage
       (refresh_run_id, content_url_id, range_key, start_date, end_date, previous_start_date, previous_end_date,
        clicks, impressions, ctr, position, previous_clicks, previous_impressions, previous_ctr, previous_position,
        click_delta, click_growth_pct, impression_delta, impression_growth_pct, growth_status, data_status)
     values ($1, $2, 'last_1_month', date '2026-08-01', date '2026-08-31', date '2026-07-01', date '2026-07-31',
             12, 120, 0.1, 8, 10, 100, 0.1, 9, 2, 0.2, 20, 0.2, 'growing', 'ok')`,
    [refreshRun.id, contentUrl.id],
  );
  await publishStagedPerformanceCache(refreshRun.id, client);
  const { rows: [published] } = await client.query(
    `select clicks::float8 as clicks, published_refresh_run_id
     from public.seo_performance_cache where content_url_id = $1 and range_key = 'last_1_month'`,
    [contentUrl.id],
  );
  assert.equal(published?.clicks, 12, "staged clicks must be published");
  assert.equal(published?.published_refresh_run_id, refreshRun.id, "published cache must retain its source run");

  await upsertPerformanceCache({
    contentUrlId: contentUrl.id,
    rangeKey: "last_1_month",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    previousStartDate: "2026-07-01",
    previousEndDate: "2026-07-31",
    growth: {
      clicks: 13, impressions: 130, ctr: 0.1, position: 8,
      previousClicks: 10, previousImpressions: 100, previousCtr: 0.1, previousPosition: 9,
      clickDelta: 3, clickGrowthPct: 0.3, impressionDelta: 30, impressionGrowthPct: 0.3,
      growthStatus: "growing", dataStatus: "ok",
    },
  }, client);
  const { rows: [upserted] } = await client.query(
    `select clicks::float8 as clicks, published_refresh_run_id
     from public.seo_performance_cache where content_url_id = $1 and range_key = 'last_1_month'`,
    [contentUrl.id],
  );
  assert.equal(upserted?.clicks, 13, "direct upsert must execute and update the cache");
  assert.equal(upserted?.published_refresh_run_id, refreshRun.id, "direct upsert must preserve existing publication lineage");

  const { rows: [stagedRun] } = await client.query(
    `select r.id, count(*)::int as staged_count
     from public.refresh_runs r
     join public.seo_performance_cache_stage s on s.refresh_run_id = r.id
     where r.status = 'failed' and r.published = false and s.error_message is null
     group by r.id
     order by r.created_at desc
     limit 1`,
  );
  if (stagedRun) {
    await publishStagedPerformanceCache(stagedRun.id, client);
    const { rows: [publishedRun] } = await client.query(
      `select count(*)::int as count
       from public.seo_performance_cache
       where published_refresh_run_id = $1`,
      [stagedRun.id],
    );
    assert.equal(publishedRun?.count, stagedRun.staged_count, "the latest failed staged run must publish every staged URL");
  }
  console.log("Refresh DB migration and publication verification passed (transaction rolled back).");
} finally {
  await client.query("rollback").catch(() => undefined);
  client.release();
  await pool.end();
}
