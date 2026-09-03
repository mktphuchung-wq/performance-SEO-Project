// End-to-end check of the warning evaluator against the real database.
//
// The claim this feature makes, above every other, is that it changes no KPI.
// This is the test of that claim: snapshot every stored score, run the whole
// evaluation, and compare byte for byte. It also proves the evaluation is
// idempotent, which is what stops a daily refresh from re-queueing the same URL
// or turning "two consecutive months" into "two days".
//
//   node --import ./scripts/alias-loader.mjs scripts/verify-warning-evaluation.mjs
//
// Writes warnings and may open audit cases, exactly as the app does. Run it
// against a development database.
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(projectDir);

if (!process.env.DATABASE_URL) {
  console.log("Warning evaluation check skipped: DATABASE_URL is not configured.");
  process.exit(0);
}

const { query } = await import("@/lib/db");
const { evaluateWarningsForClosedMonth } = await import("@/lib/performance/warning-evaluation");
const { computeOfficialKpi } = await import("@/lib/performance/composite-score");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/** Every number the KPI is built from, in a form two runs can be compared on. */
async function kpiFingerprint() {
  const members = await query(
    `select member_name, range_key, kpi_score, eligible_url_count, excluded_url_count,
            no_data_url_count, capped_url_count, total_weight,
            base_kpi_score, click_component_score, impression_component_score,
            effective_click_weight, effective_impression_weight,
            direction_adjustment, opposite_sign_factor, formula_version
       from public.member_performance_score order by member_name, range_key`,
  );
  const urls = await query(
    `select content_url_id, range_key, score_state, score, click_score, impression_score,
            weight, baseline_clicks, baseline_impressions
       from public.url_performance_score order by content_url_id, range_key`,
  );
  const official = new Map();
  for (const row of members) {
    const entry = official.get(row.member_name) ?? { score1m: null, score3m: null, score6m: null };
    if (row.range_key === "last_1_month") entry.score1m = row.kpi_score;
    if (row.range_key === "last_3_months") entry.score3m = row.kpi_score;
    if (row.range_key === "last_6_months") entry.score6m = row.kpi_score;
    official.set(row.member_name, entry);
  }
  const officialKpi = [...official.entries()]
    .map(([name, scores]) => [name, computeOfficialKpi(scores).officialKpi])
    .sort();
  return { members, urls, officialKpi };
}

console.log("");
console.log("This writes real warnings and may open real audit cases. Audit events are");
console.log("append-only and cannot be deleted afterwards - point it at a dev database.");

console.log("\nBefore");
const before = await kpiFingerprint();
console.log(`  ${before.members.length} member score row(s), ${before.urls.length} URL score row(s)`);
console.log(`  Official KPI: ${before.officialKpi.map(([n, v]) => `${n}=${v}`).join(", ") || "none"}`);

console.log("\nEvaluation");
const first = await evaluateWarningsForClosedMonth({ actorId: "verify-script" });
console.log(`  month=${first.evaluationMonth} written=${first.warningsWritten} `
  + `early=${first.earlyWarnings} mandatory=${first.mandatoryAudits} `
  + `opened=${first.auditsOpened} linked=${first.auditsLinked} recovered=${first.recoveredWarnings}`);
check("the evaluation completed against real data", true);

console.log("\nThe KPI must not have moved");
const after = await kpiFingerprint();
check("every member score row is identical",
  JSON.stringify(before.members) === JSON.stringify(after.members));
check("every URL score row is identical",
  JSON.stringify(before.urls) === JSON.stringify(after.urls));
check("every Official KPI is identical",
  JSON.stringify(before.officialKpi) === JSON.stringify(after.officialKpi),
  after.officialKpi.map(([n, v]) => `${n}=${v}`).join(", "));

console.log("\nIdempotency");
const countsBefore = await query(
  "select (select count(*) from public.url_kpi_warnings)::int w, (select count(*) from public.url_kpi_audits)::int a",
);
const second = await evaluateWarningsForClosedMonth({ actorId: "verify-script" });
const third = await evaluateWarningsForClosedMonth({ actorId: "verify-script" });
const countsAfter = await query(
  "select (select count(*) from public.url_kpi_warnings)::int w, (select count(*) from public.url_kpi_audits)::int a",
);
check("two further runs add no warning rows", countsBefore[0].w === countsAfter[0].w,
  `${countsBefore[0].w} -> ${countsAfter[0].w}`);
check("two further runs open no extra audits", countsBefore[0].a === countsAfter[0].a,
  `${countsBefore[0].a} -> ${countsAfter[0].a}`);
check("every run reports the same closed month",
  first.evaluationMonth === second.evaluationMonth && second.evaluationMonth === third.evaluationMonth);
check("every run finds the same warnings",
  first.warningsWritten === second.warningsWritten && second.warningsWritten === third.warningsWritten,
  `${first.warningsWritten}, ${second.warningsWritten}, ${third.warningsWritten}`);

const finalKpi = await kpiFingerprint();
check("the KPI is still untouched after three evaluations",
  JSON.stringify(before.officialKpi) === JSON.stringify(finalKpi.officialKpi));

console.log("\nWhat was written");
const sample = await query(
  `select w.member_name, w.range_key, w.level, w.kpi_drag_points, w.raw_score_snapshot,
          w.consecutive_count, c.url
     from public.url_kpi_warnings w join public.content_urls c on c.id = w.content_url_id
    order by w.kpi_drag_points desc limit 5`,
);
for (const row of sample) {
  console.log(`  ${row.level} · ${row.member_name} · ${row.range_key} · drag=${Number(row.kpi_drag_points).toFixed(2)}`
    + ` · score=${row.raw_score_snapshot === null ? "—" : Number(row.raw_score_snapshot).toFixed(1)} · ${row.url}`);
}
if (sample.length === 0) console.log("  (no warnings met the thresholds)");

console.log(failures === 0 ? "\nAll warning evaluation checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
