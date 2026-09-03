// Schema verification for migration 015 — the opposite-sign member columns.
//
// Applies the migration inside a transaction and rolls it back, so it can be run
// against any environment that has the earlier migrations, including production,
// without leaving anything behind. What it proves is that the constraints are
// enforced by Postgres and not merely by the application: an effective weight
// pair that does not sum to 1, or a direction with no factor to reproduce it,
// has to be rejected by the database, because the application is not the only
// thing that will ever write these rows.
//
//   node scripts/verify-member-score-db.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(projectDir);

if (!process.env.DATABASE_URL) {
  console.log("Member score DB verification skipped: DATABASE_URL is not configured.");
  process.exit(0);
}

const migrationPath = path.join(projectDir, "migrations", "015_member_opposite_sign.sql");
const migration = (await readFile(migrationPath, "utf8"))
  .replace(/^\s*begin;\s*/i, "")
  .replace(/\s*commit;\s*$/i, "");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();

let failures = 0;
function check(label, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  if (!ok) failures += 1;
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/** A write that must be refused. Runs in a savepoint so one rejection does not poison the rest. */
async function mustReject(label, sql, params = []) {
  await client.query("savepoint probe");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint probe");
    check(label, false, "the database accepted it");
  } catch (error) {
    await client.query("rollback to savepoint probe");
    check(label, true, String(error.message).split("\n")[0].slice(0, 90));
  }
}

async function mustAccept(label, sql, params = []) {
  await client.query("savepoint probe");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint probe");
    check(label, true);
  } catch (error) {
    await client.query("rollback to savepoint probe");
    check(label, false, String(error.message).split("\n")[0].slice(0, 90));
  }
}

const insertMember = `insert into public.member_performance_score
    (member_name, range_key, start_date, end_date, kpi_score, base_kpi_score,
     click_component_score, impression_component_score,
     effective_click_weight, effective_impression_weight,
     direction_adjustment, opposite_sign_factor, formula_version)
  values ($1, 'last_1_month', '2026-01-01', '2026-01-31', $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

const row = (over = {}) => {
  const base = {
    name: `verify-${Math.random().toString(36).slice(2, 10)}`,
    kpiScore: 66.0652,
    baseKpiScore: 59.9314,
    clickComponent: 74.8276,
    impressionComponent: 25.1724,
    clickWeight: 0.8235294117647058,
    impressionWeight: 0.17647058823529413,
    direction: "click_up_impression_down",
    factor: 0.5,
    formula: "member-opposite-sign-v1",
    ...over,
  };
  return [
    base.name, base.kpiScore, base.baseKpiScore, base.clickComponent, base.impressionComponent,
    base.clickWeight, base.impressionWeight, base.direction, base.factor, base.formula,
  ];
};

try {
  await client.query("begin");
  await client.query(migration);

  console.log("columns and defaults");
  {
    const result = await client.query(`
      select column_name, is_nullable, column_default
        from information_schema.columns
       where table_schema = 'public' and table_name = 'member_performance_score'
         and column_name in ('base_kpi_score', 'click_component_score', 'impression_component_score',
                             'effective_click_weight', 'effective_impression_weight',
                             'direction_adjustment', 'opposite_sign_factor', 'formula_version')
    `);
    const byName = new Map(result.rows.map((r) => [r.column_name, r]));
    check("all eight member columns exist", byName.size === 8, `${byName.size} of 8`);
    check("direction_adjustment is not null and defaults to 'none'",
      byName.get("direction_adjustment")?.is_nullable === "NO"
        && String(byName.get("direction_adjustment")?.column_default ?? "").includes("none"));
    // A NOT NULL column cannot be added to a populated table without a default,
    // and 'legacy' is the honest value for every row written before the rule.
    check("formula_version is not null and defaults to 'legacy'",
      byName.get("formula_version")?.is_nullable === "NO"
        && String(byName.get("formula_version")?.column_default ?? "").includes("legacy"));
    check("the score and weight columns stay nullable",
      ["base_kpi_score", "click_component_score", "impression_component_score",
       "effective_click_weight", "effective_impression_weight", "opposite_sign_factor"]
        .every((name) => byName.get(name)?.is_nullable === "YES"));

    const warning = await client.query(`
      select is_nullable, data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'url_kpi_warnings'
         and column_name = 'effective_score_snapshot'
    `);
    check("url_kpi_warnings.effective_score_snapshot exists and is nullable",
      warning.rows[0]?.is_nullable === "YES" && warning.rows[0]?.data_type === "numeric");

    const project = await client.query(`
      select count(*)::int as n from information_schema.columns
       where table_schema = 'public' and table_name = 'project_performance_score'
         and column_name in ('direction_adjustment', 'base_kpi_score', 'formula_version')
    `);
    check("project_performance_score is left alone", project.rows[0]?.n === 0, `${project.rows[0]?.n} column(s)`);
  }

  console.log("\nconstraints reject what they are there to reject");
  {
    await mustReject("a direction outside the three defined values",
      insertMember, row({ direction: "sideways" }));
    await mustReject("a base score above 100", insertMember, row({ baseKpiScore: 101 }));
    await mustReject("a component score below 0", insertMember, row({ clickComponent: -0.5 }));
    await mustReject("effective weights that do not sum to 1",
      insertMember, row({ clickWeight: 0.7, impressionWeight: 0.2 }));
    await mustReject("a factor recorded with no direction to explain it",
      insertMember, row({ direction: "none", factor: 0.5 }));
    await mustReject("a direction recorded with no factor to reproduce it",
      insertMember, row({ direction: "click_up_impression_down", factor: null }));
    await mustReject("a factor of 0, which would erase a metric rather than discount it",
      insertMember, row({ factor: 0 }));
    await mustReject("an effective score snapshot outside 0-100",
      `insert into public.url_kpi_warnings
         (content_url_id, member_name, range_key, evaluation_month, start_date, end_date,
          rule_version, level, effective_score_snapshot)
       select id, 'verify', 'last_1_month', '2026-01-01', '2026-01-01', '2026-01-31',
              'warning-v2', 'early_warning', 101
         from public.content_urls limit 1`);
    await mustReject("kpi_settings weights that do not sum to 1",
      "update public.kpi_settings set click_weight = 0.8, impression_weight = 0.3 where id = 1");
  }

  console.log("\nand accept what they must");
  {
    await mustAccept("an adjusted member row", insertMember, row());
    await mustAccept("an unadjusted member row",
      insertMember, row({ direction: "none", factor: null, clickWeight: 0.7, impressionWeight: 0.3 }));
    // No eligible URL: no score and no components, but the weights it would have
    // been graded at are still recorded, so the row stays auditable.
    await mustAccept("a member with nothing scoreable",
      insertMember, row({ kpiScore: null, baseKpiScore: null, clickComponent: null, impressionComponent: null }));
    await mustAccept("a legacy row, untouched by the recompute",
      insertMember, row({ baseKpiScore: null, clickComponent: null, impressionComponent: null,
        clickWeight: null, impressionWeight: null, direction: "none", factor: null, formula: "legacy" }));
    await mustAccept("kpi_settings weights that do sum to 1",
      "update public.kpi_settings set click_weight = 0.6, impression_weight = 0.4 where id = 1");
  }

  console.log("\nupsert idempotency");
  {
    const upsert = `insert into public.member_performance_score
        (member_name, member_email, range_key, start_date, end_date, kpi_score,
         eligible_url_count, excluded_url_count, no_data_url_count, capped_url_count, total_weight,
         base_kpi_score, click_component_score, impression_component_score,
         effective_click_weight, effective_impression_weight,
         direction_adjustment, opposite_sign_factor, formula_version, refreshed_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now(), now())
      on conflict (member_name, range_key) do update set
        member_email = excluded.member_email,
        base_kpi_score = excluded.base_kpi_score,
        click_component_score = excluded.click_component_score,
        impression_component_score = excluded.impression_component_score,
        effective_click_weight = excluded.effective_click_weight,
        effective_impression_weight = excluded.effective_impression_weight,
        direction_adjustment = excluded.direction_adjustment,
        opposite_sign_factor = excluded.opposite_sign_factor,
        formula_version = excluded.formula_version,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        kpi_score = excluded.kpi_score,
        eligible_url_count = excluded.eligible_url_count,
        excluded_url_count = excluded.excluded_url_count,
        no_data_url_count = excluded.no_data_url_count,
        capped_url_count = excluded.capped_url_count,
        total_weight = excluded.total_weight,
        refreshed_at = now(),
        updated_at = now()`;
    const name = `verify-upsert-${Math.random().toString(36).slice(2, 10)}`;
    const args = (over) => [
      name, "verify@example.com", "last_1_month", "2026-01-01", "2026-01-31", over.kpiScore,
      3, 0, 1, 0, 1750,
      over.baseKpiScore, over.clickComponent, over.impressionComponent,
      over.clickWeight, over.impressionWeight, over.direction, over.factor, over.formula,
    ];

    await client.query("savepoint upsert");
    await client.query(upsert, args({
      kpiScore: 59.9314, baseKpiScore: 59.9314, clickComponent: 74.8276, impressionComponent: 25.1724,
      clickWeight: 0.7, impressionWeight: 0.3, direction: "none", factor: null, formula: "member-opposite-sign-v1",
    }));
    await client.query(upsert, args({
      kpiScore: 66.0652, baseKpiScore: 59.9314, clickComponent: 74.8276, impressionComponent: 25.1724,
      clickWeight: 0.8235294117647058, impressionWeight: 0.17647058823529413,
      direction: "click_up_impression_down", factor: 0.5, formula: "member-opposite-sign-v1",
    }));
    const after = await client.query(
      `select count(*)::int as n, max(direction_adjustment) as direction,
              max(kpi_score) as kpi_score, max(base_kpi_score) as base
         from public.member_performance_score where member_name = $1 and range_key = 'last_1_month'`,
      [name],
    );
    const stored = after.rows[0];
    check("a second run updates the row rather than adding one", stored?.n === 1, `${stored?.n} row(s)`);
    check("the second run's adjustment is what stuck", stored?.direction === "click_up_impression_down");
    check("and the base score survives beside the adjusted one",
      Number(stored?.kpi_score) !== Number(stored?.base),
      `kpi=${stored?.kpi_score} base=${stored?.base}`);
    await client.query("rollback to savepoint upsert");
  }

  console.log(failures === 0
    ? "\nMember score DB migration verification passed (transaction rolled back)."
    : `\n${failures} check(s) failed (transaction rolled back).`);
} finally {
  await client.query("rollback").catch(() => undefined);
  client.release();
  await pool.end();
}

process.exit(failures === 0 ? 0 : 1);
