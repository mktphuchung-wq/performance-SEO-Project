import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(projectDir);

if (!process.env.DATABASE_URL) {
  console.log("Refresh preflight DB verification skipped: DATABASE_URL is not configured.");
  process.exit(0);
}

const { query } = await import("@/lib/db");
const { startRefresh } = await import("@/lib/performance/refresh");
const { RefreshPreflightError } = await import("@/lib/performance/refresh-preflight");

const mappings = await query("select count(*)::int as count from public.project_gsc_properties");
if (mappings[0]?.count > 0) {
  console.log("Refresh preflight DB verification skipped: mappings are configured, so a fake token must not be used.");
  process.exit(0);
}

const before = await query("select count(*)::int as count from public.refresh_runs");
await assert.rejects(
  () => startRefresh("not-a-google-token", null, "last_1_month"),
  (error) => error instanceof RefreshPreflightError
    && error.code === "MISSING_GSC_MAPPING"
    && error.projects.reduce((total, project) => total + project.affectedUrlCount, 0) > 0,
);
const after = await query("select count(*)::int as count from public.refresh_runs");
assert.equal(after[0]?.count, before[0]?.count, "missing mapping must not create a refresh run");

console.log("Refresh preflight DB verification passed (missing mapping created no run and made no Google call).");
