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

const migrationPath = path.join(projectDir, "migrations", "010_refresh_range_reliability.sql");
const migration = (await readFile(migrationPath, "utf8"))
  .replace(/^\s*begin;\s*/i, "")
  .replace(/\s*commit;\s*$/i, "");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();

try {
  await client.query("begin");
  await client.query(migration);
  const result = await client.query(`
    select
      to_regclass('public.refresh_run_items') is not null as has_items,
      to_regclass('public.seo_performance_cache_stage') is not null as has_stage,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'refresh_runs' and column_name = 'phase'
      ) as has_phase
  `);
  const checks = result.rows[0];
  if (!checks?.has_items || !checks?.has_stage || !checks?.has_phase) throw new Error("Refresh migration schema checks failed");
  const arrayCast = await client.query(`
    select cardinality(content_url_ids) as count
    from jsonb_to_recordset('[{"content_url_ids":["00000000-0000-0000-0000-000000000001"]}]'::jsonb)
      as x(content_url_ids uuid[])
  `);
  if (arrayCast.rows[0]?.count !== 1) throw new Error("Refresh item UUID array conversion failed");
  console.log("Refresh DB migration verification passed (transaction rolled back).");
} finally {
  await client.query("rollback").catch(() => undefined);
  client.release();
  await pool.end();
}
