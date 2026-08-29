// Proves the guarantees migration 014 claims are actually enforced by Postgres,
// not merely by the code that usually writes these tables. Everything runs
// inside one transaction that is always rolled back.
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";

const projectDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
nextEnv.loadEnvConfig(projectDir);

if (!process.env.DATABASE_URL) {
  console.log("Warning/Audit DB verification skipped: DATABASE_URL is not configured.");
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/** Runs a statement inside a savepoint and reports whether Postgres refused it. */
async function refuses(name, sql, params = []) {
  await client.query("savepoint sp");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint sp");
    check(name, false, "statement was accepted but should have been rejected");
  } catch (error) {
    await client.query("rollback to savepoint sp");
    check(name, true, String(error.message).split("\n")[0].slice(0, 90));
  }
}

try {
  await client.query("begin");

  for (const table of ["kpi_audit_roles", "url_kpi_audits", "url_kpi_warnings", "url_kpi_audit_events"]) {
    const { rows } = await client.query("select to_regclass($1) is not null as present", [`public.${table}`]);
    check(`table ${table} exists`, rows[0].present);
  }

  const settingsColumns = [
    "warning_click_drop_pct", "warning_min_click_loss", "warning_url_score_ceiling",
    "warning_drag_points_1m", "warning_drag_points_3m", "warning_consecutive_months",
    "audit_sla_days", "audit_exposure_escalation_pct",
  ];
  const { rows: colRows } = await client.query(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'kpi_settings' and column_name = any($1::text[])`,
    [settingsColumns],
  );
  check("kpi_settings has all 8 warning/audit thresholds", colRows[0].n === settingsColumns.length, `found ${colRows[0].n}`);

  // A real URL to hang the fixtures off. Rolled back with everything else.
  const { rows: urlRows } = await client.query(
    `insert into public.content_urls (url_hash, project, url, member_name)
     values ('verify-warning-audit-hash', 'Verify', 'https://example.com/verify-warning-audit', 'Verifier')
     returning id`,
  );
  const urlId = urlRows[0].id;
  const deadline = new Date(Date.now() + 86400000).toISOString();

  const { rows: auditRows } = await client.query(
    `insert into public.url_kpi_audits (content_url_id, opened_by, sla_deadline, policy_version)
     values ($1, 'opener@example.com', $2, 'audit-policy-v1') returning id`,
    [urlId, deadline],
  );
  const auditId = auditRows[0].id;

  await refuses(
    "a second open case for the same URL is refused",
    `insert into public.url_kpi_audits (content_url_id, opened_by, sla_deadline, policy_version)
     values ($1, 'other@example.com', $2, 'audit-policy-v1')`,
    [urlId, deadline],
  );

  // Evidence and note supplied, so url_kpi_audits_evidence_required cannot be
  // what rejects this — the share check is the only constraint left standing.
  await refuses(
    "external_share of 0.37 is refused",
    `update public.url_kpi_audits
        set conclusion = 'mixed', external_share = 0.37,
            evidence = '{"cohort": "checked"}'::jsonb, confidence_note = 'medium'
      where id = $1`,
    [auditId],
  );

  await refuses(
    "external_verified without evidence is refused",
    `update public.url_kpi_audits
        set conclusion = 'external_verified', external_share = 1, confidence_note = 'sure'
      where id = $1`,
    [auditId],
  );

  await refuses(
    "resolved without a conclusion is refused",
    `update public.url_kpi_audits set status = 'resolved' where id = $1`,
    [auditId],
  );

  await refuses(
    "the proposer approving their own conclusion is refused",
    `update public.url_kpi_audits
        set status = 'resolved', conclusion = 'controllable', external_share = 0,
            proposed_by = 'a@example.com', proposed_at = now(),
            approved_by = 'A@Example.com', approved_at = now()
      where id = $1`,
    [auditId],
  );

  await refuses(
    "a cause window that ends before it starts is refused",
    `update public.url_kpi_audits set cause_start_date = '2026-06-01', cause_end_date = '2026-05-01' where id = $1`,
    [auditId],
  );

  await client.query("savepoint ok");
  await client.query(
    `update public.url_kpi_audits
        set status = 'resolved', conclusion = 'controllable', external_share = 0,
            proposed_by = 'a@example.com', proposed_at = now(),
            approved_by = 'b@example.com', approved_at = now(), resolved_at = now()
      where id = $1`,
    [auditId],
  );
  check("a complete resolution by a distinct approver is accepted", true);
  await client.query("rollback to savepoint ok");

  await client.query(
    `insert into public.url_kpi_audit_events
       (audit_id, content_url_id, event_type, actor_id, policy_version)
     values ($1, $2, 'opened', 'opener@example.com', 'audit-policy-v1')`,
    [auditId, urlId],
  );
  await refuses(
    "updating an audit event is refused by the trigger",
    "update public.url_kpi_audit_events set actor_id = 'someone-else' where audit_id = $1",
    [auditId],
  );
  await refuses(
    "deleting an audit event is refused by the trigger",
    "delete from public.url_kpi_audit_events where audit_id = $1",
    [auditId],
  );

  const warningCols = { url: urlId, month: "2026-07-01" };
  await client.query(
    `insert into public.url_kpi_warnings
       (content_url_id, member_name, range_key, evaluation_month, start_date, end_date, rule_version, level)
     values ($1, 'Verifier', 'last_1_month', $2, '2026-07-01', '2026-07-31', 'warning-v1', 'early_warning')`,
    [warningCols.url, warningCols.month],
  );
  await refuses(
    "a duplicate warning for the same URL/member/range/month is refused",
    `insert into public.url_kpi_warnings
       (content_url_id, member_name, range_key, evaluation_month, start_date, end_date, rule_version, level)
     values ($1, 'Verifier', 'last_1_month', $2, '2026-07-01', '2026-07-31', 'warning-v1', 'mandatory_audit')`,
    [warningCols.url, warningCols.month],
  );

  await refuses(
    "kpi_settings rejects a click-drop threshold of 0",
    "update public.kpi_settings set warning_click_drop_pct = 0 where id = 1",
  );
  await refuses(
    "kpi_settings rejects a consecutive-month threshold below 2",
    "update public.kpi_settings set warning_consecutive_months = 1 where id = 1",
  );

  const { rows: phaseRows } = await client.query(
    `select pg_get_constraintdef(oid) like '%warning%' as has_warning
       from pg_constraint where conname = 'refresh_runs_phase_check'`,
  );
  check("refresh_runs accepts the new 'warning' phase", phaseRows[0]?.has_warning === true);
} finally {
  await client.query("rollback").catch(() => undefined);
  client.release();
  await pool.end();
}

console.log(failures === 0 ? "\nAll warning/audit DB checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
