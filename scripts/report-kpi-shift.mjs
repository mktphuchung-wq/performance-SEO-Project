// Before/after reconciliation for the Member × Range opposite-sign rule.
//
// Snapshots every score, recomputes all three rolling ranges from the cache
// already in Postgres, and reports what moved. Two things it is looking for:
// that the URL and Project scores did not move at all (the rule is a member-grain
// rule, and anything else moving means it leaked), and how far the member scores
// travelled, so the size of the change is a number somebody signed off on rather
// than a surprise on the dashboard.
//
// Never calls Search Console. It does write score rows — it runs the real
// recompute — so the numbers afterwards are the ones the app will serve.
//
//   node --import ./scripts/alias-loader.mjs scripts/report-kpi-shift.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(projectDir);

if (!process.env.DATABASE_URL) {
  console.log("KPI shift report skipped: DATABASE_URL is not configured.");
  process.exit(0);
}

const { getPool, query } = await import("../lib/db.ts");
const { computeAndStoreScores } = await import("../lib/performance/refresh.ts");
const { getRangeFreshness } = await import("../lib/repositories/performance-cache.ts");
const { SELECTABLE_RANGE_KEYS, isRollingRange } = await import("../lib/ranges.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const num = (v) => (v === null || v === undefined ? null : Number(v));
const fmt = (v, d = 3) => (v === null ? "—" : Number(v).toFixed(d));

async function snapshot() {
  const members = await query(
    `select member_name, range_key, kpi_score, base_kpi_score, direction_adjustment, formula_version
       from public.member_performance_score order by member_name, range_key`,
  );
  const projects = await query(
    `select project, range_key, kpi_score, eligible_url_count, total_weight
       from public.project_performance_score order by project, range_key`,
  );
  const urls = await query(
    `select content_url_id, range_key, score_state, score, click_score, impression_score, weight
       from public.url_performance_score order by content_url_id, range_key`,
  );
  return { members, projects, urls };
}

const keyed = (rows, keyOf) => new Map(rows.map((row) => [keyOf(row), row]));

try {
  console.log("before — reading the published scores");
  const before = await snapshot();
  console.log(`   ${before.members.length} member rows · ${before.projects.length} project rows · ${before.urls.length} URL rows`);

  console.log("\nrecomputing every rolling range from cache (no Search Console calls)");
  const freshness = await getRangeFreshness();
  const windowByRange = new Map(freshness.map((f) => [f.range_key, f]));
  for (const rangeKey of SELECTABLE_RANGE_KEYS.filter(isRollingRange)) {
    const window = windowByRange.get(rangeKey);
    if (!window?.start_date || !window.end_date) {
      console.log(`   ${rangeKey}: skipped, never refreshed`);
      continue;
    }
    await computeAndStoreScores(rangeKey, window.start_date, window.end_date);
    console.log(`   ${rangeKey}: ${window.start_date} → ${window.end_date}`);
  }

  const after = await snapshot();

  console.log("\nnothing outside the member grain may have moved");
  {
    const beforeProjects = keyed(before.projects, (r) => `${r.project}|${r.range_key}`);
    let moved = 0;
    for (const row of after.projects) {
      const was = beforeProjects.get(`${row.project}|${row.range_key}`);
      if (!was) continue;
      if (num(was.kpi_score) !== num(row.kpi_score)) moved += 1;
    }
    check("project scores are unchanged", moved === 0, `${moved} moved`);

    const beforeUrls = keyed(before.urls, (r) => `${r.content_url_id}|${r.range_key}`);
    let urlMoved = 0;
    for (const row of after.urls) {
      const was = beforeUrls.get(`${row.content_url_id}|${row.range_key}`);
      if (!was) continue;
      if (num(was.score) !== num(row.score) || was.score_state !== row.score_state) urlMoved += 1;
    }
    check("URL scores are unchanged", urlMoved === 0, `${urlMoved} moved`);
  }

  console.log("\nevery member row is now explainable");
  {
    const stale = after.members.filter((r) => r.formula_version !== "member-opposite-sign-v1");
    check("no member row is left on the old formula", stale.length === 0,
      `${stale.length} row(s) still ${stale[0]?.formula_version ?? "—"}`);

    const unexplained = after.members.filter((r) => r.kpi_score !== null && r.base_kpi_score === null);
    check("every scored member has a base score beside it", unexplained.length === 0, `${unexplained.length} row(s)`);
  }

  console.log("\nhow far the member scores travelled");
  {
    const beforeMembers = keyed(before.members, (r) => `${r.member_name}|${r.range_key}`);
    const byRange = new Map();
    for (const row of after.members) {
      const bucket = byRange.get(row.range_key) ?? { total: 0, adjusted: 0, deltas: [], newRows: 0 };
      bucket.total += 1;
      if (row.direction_adjustment !== "none") bucket.adjusted += 1;
      const was = beforeMembers.get(`${row.member_name}|${row.range_key}`);
      if (!was) bucket.newRows += 1;
      else if (num(was.kpi_score) !== null && num(row.kpi_score) !== null) {
        bucket.deltas.push(num(row.kpi_score) - num(was.kpi_score));
      }
      byRange.set(row.range_key, bucket);
    }

    for (const [rangeKey, b] of [...byRange.entries()].sort()) {
      const deltas = b.deltas.filter((d) => Math.abs(d) > 1e-9).sort((a, c) => a - c);
      const mean = deltas.length ? deltas.reduce((s, d) => s + d, 0) / deltas.length : null;
      console.log(
        `   ${rangeKey}: ${b.adjusted}/${b.total} adjusted · ${deltas.length} score(s) moved`
          + ` · min ${fmt(deltas[0] ?? null)} · max ${fmt(deltas[deltas.length - 1] ?? null)} · mean ${fmt(mean)}`
          + (b.newRows ? ` · ${b.newRows} new row(s)` : ""),
      );
      // A member who was not adjusted must not have moved at all. Anything else
      // means the rule reached a row it was never supposed to touch.
      const adjustedNames = new Set(
        after.members.filter((r) => r.range_key === rangeKey && r.direction_adjustment !== "none")
          .map((r) => r.member_name),
      );
      const unexpected = after.members.filter((r) => {
        if (r.range_key !== rangeKey || adjustedNames.has(r.member_name)) return false;
        const was = beforeMembers.get(`${r.member_name}|${rangeKey}`);
        return was && num(was.kpi_score) !== null && num(r.kpi_score) !== null
          && Math.abs(num(r.kpi_score) - num(was.kpi_score)) > 1e-9;
      });
      check(`${rangeKey}: unadjusted members did not move`, unexpected.length === 0,
        unexpected.slice(0, 3).map((r) => r.member_name).join(", "));
    }
  }

  console.log("\nthe adjusted rows, in full");
  {
    const rows = await query(
      `select member_name, range_key, base_kpi_score, kpi_score,
              click_component_score, impression_component_score,
              effective_click_weight, effective_impression_weight, opposite_sign_factor,
              direction_adjustment
         from public.member_performance_score
        where direction_adjustment <> 'none'
        order by abs(coalesce(kpi_score, 0) - coalesce(base_kpi_score, 0)) desc
        limit 40`,
    );
    if (rows.length === 0) console.log("   none — no member has opposite-sign totals in any range.");
    for (const r of rows) {
      console.log(
        `   ${r.member_name} · ${r.range_key} · ${r.direction_adjustment}`
          + ` · ${fmt(num(r.base_kpi_score), 2)} → ${fmt(num(r.kpi_score), 2)}`
          + ` · C ${fmt(num(r.click_component_score), 1)} / I ${fmt(num(r.impression_component_score), 1)}`
          + ` · weights ${fmt(num(r.effective_click_weight) * 100, 2)}% / ${fmt(num(r.effective_impression_weight) * 100, 2)}%`,
      );
    }
  }

  console.log("\nthe stored score is reproducible from its own components");
  {
    // The 1e-9 reconciliation §10 asks for, run against what is actually in the
    // table rather than against the function that wrote it.
    const rows = await query(
      `select member_name, range_key, kpi_score, click_component_score, impression_component_score,
              effective_click_weight, effective_impression_weight
         from public.member_performance_score
        where kpi_score is not null and click_component_score is not null`,
    );
    let off = 0;
    let worst = 0;
    for (const r of rows) {
      const rebuilt = num(r.effective_click_weight) * num(r.click_component_score)
        + num(r.effective_impression_weight) * num(r.impression_component_score);
      const residual = Math.abs(Math.max(0, Math.min(100, rebuilt)) - num(r.kpi_score));
      if (residual > worst) worst = residual;
      if (residual > 1e-9) off += 1;
    }
    check(`kpi_score = ewc·C + ewi·I over ${rows.length} rows`, off === 0,
      `${off} row(s) off · worst residual ${worst.toExponential(2)}`);
  }

  console.log(failures === 0 ? "\nReconciliation passed." : `\n${failures} check(s) failed.`);
} finally {
  await getPool().end().catch(() => undefined);
}

process.exit(failures === 0 ? 0 : 1);
