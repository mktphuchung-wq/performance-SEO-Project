import type { QueryResultRow } from "pg";
import { query, type DbExecutor } from "@/lib/db";
import { getSyncBulkChunkSize } from "@/lib/env";
import type { AuditStatus } from "@/lib/performance/audit-workflow";
import type { WarningLevel, WarningRangeKey } from "@/lib/performance/warning";

export type WarningResolution = "recovered" | "audit_resolved" | "superseded";

export interface UrlKpiWarningRow {
  id: string;
  content_url_id: string;
  member_name: string;
  range_key: WarningRangeKey;
  evaluation_month: string;
  start_date: string;
  end_date: string;
  rule_version: string;
  level: WarningLevel;
  metric_snapshot: Record<string, unknown>;
  attribution_snapshot: Record<string, unknown>;
  settings_snapshot: Record<string, unknown>;
  raw_score_snapshot: number | null;
  /** The score this member's drag was actually taken against, at their effective weights. */
  effective_score_snapshot: number | null;
  capped_weight_snapshot: number;
  member_total_weight_snapshot: number;
  kpi_drag_points: number;
  consecutive_count: number;
  audit_id: string | null;
  triggered_at: string;
  resolved_at: string | null;
  resolution: WarningResolution | null;
}

export interface WarningQueueRow extends UrlKpiWarningRow {
  url: string;
  project: string;
  audit_status: AuditStatus | null;
  audit_sla_deadline: string | null;
}

export interface UpsertWarningInput {
  contentUrlId: string;
  memberName: string;
  rangeKey: WarningRangeKey;
  evaluationMonth: string;
  startDate: string;
  endDate: string;
  ruleVersion: string;
  level: WarningLevel;
  metricSnapshot: unknown;
  attributionSnapshot: unknown;
  settingsSnapshot: unknown;
  rawScoreSnapshot: number | null;
  effectiveScoreSnapshot: number | null;
  cappedWeightSnapshot: number;
  memberTotalWeightSnapshot: number;
  kpiDragPoints: number;
  consecutiveCount: number;
}

export interface UpsertedWarning {
  id: string;
  content_url_id: string;
  member_name: string;
  range_key: WarningRangeKey;
  level: WarningLevel;
}

function executorQuery<T extends QueryResultRow>(
  db: DbExecutor | undefined,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  return db ? db.query<T>(text, params).then((r) => r.rows) : query<T>(text, params);
}

/** The identity of a warning across months: same URL, same member, same range. */
export function warningKey(parts: { contentUrlId: string; memberName: string; rangeKey: string }): string {
  return `${parts.contentUrlId}|${parts.memberName}|${parts.rangeKey}`;
}

/**
 * Write this month's warnings.
 *
 * Re-running within the same month updates the snapshot in place and leaves
 * triggered_at alone: the rolling window has moved a few days, the finding has
 * not. That is what keeps a daily refresh from manufacturing a fresh warning —
 * and, more importantly, from making "two consecutive periods" mean "two days".
 *
 * A re-fire also clears any resolution, since a warning that is triggering again
 * is not recovered.
 */
export async function bulkUpsertWarnings(inputs: UpsertWarningInput[], db?: DbExecutor): Promise<UpsertedWarning[]> {
  if (inputs.length === 0) return [];
  const toPayload = (rows: UpsertWarningInput[]) =>
    rows.map((input) => ({
      content_url_id: input.contentUrlId,
      member_name: input.memberName,
      range_key: input.rangeKey,
      evaluation_month: input.evaluationMonth,
      start_date: input.startDate,
      end_date: input.endDate,
      rule_version: input.ruleVersion,
      level: input.level,
      metric_snapshot: input.metricSnapshot ?? {},
      attribution_snapshot: input.attributionSnapshot ?? {},
      settings_snapshot: input.settingsSnapshot ?? {},
      raw_score_snapshot: input.rawScoreSnapshot,
      effective_score_snapshot: input.effectiveScoreSnapshot,
      capped_weight_snapshot: input.cappedWeightSnapshot,
      member_total_weight_snapshot: input.memberTotalWeightSnapshot,
      kpi_drag_points: input.kpiDragPoints,
      consecutive_count: input.consecutiveCount,
    }));

  const sql = `insert into public.url_kpi_warnings
      (content_url_id, member_name, range_key, evaluation_month, start_date, end_date, rule_version, level,
       metric_snapshot, attribution_snapshot, settings_snapshot, raw_score_snapshot, effective_score_snapshot,
       capped_weight_snapshot, member_total_weight_snapshot, kpi_drag_points, consecutive_count)
    select x.content_url_id, x.member_name, x.range_key, x.evaluation_month, x.start_date, x.end_date,
           x.rule_version, x.level, x.metric_snapshot, x.attribution_snapshot, x.settings_snapshot,
           x.raw_score_snapshot, x.effective_score_snapshot, x.capped_weight_snapshot, x.member_total_weight_snapshot,
           x.kpi_drag_points, x.consecutive_count
    from jsonb_to_recordset($1::jsonb) as x(
      content_url_id uuid, member_name text, range_key text, evaluation_month date,
      start_date date, end_date date, rule_version text, level text,
      metric_snapshot jsonb, attribution_snapshot jsonb, settings_snapshot jsonb,
      raw_score_snapshot numeric, effective_score_snapshot numeric, capped_weight_snapshot numeric,
      member_total_weight_snapshot numeric, kpi_drag_points numeric, consecutive_count integer
    )
    on conflict (content_url_id, member_name, range_key, evaluation_month, rule_version) do update set
      start_date = excluded.start_date, end_date = excluded.end_date, level = excluded.level,
      metric_snapshot = excluded.metric_snapshot,
      attribution_snapshot = excluded.attribution_snapshot,
      settings_snapshot = excluded.settings_snapshot,
      raw_score_snapshot = excluded.raw_score_snapshot,
      effective_score_snapshot = excluded.effective_score_snapshot,
      capped_weight_snapshot = excluded.capped_weight_snapshot,
      member_total_weight_snapshot = excluded.member_total_weight_snapshot,
      kpi_drag_points = excluded.kpi_drag_points,
      consecutive_count = excluded.consecutive_count,
      resolved_at = null, resolution = null,
      updated_at = now()
    returning id, content_url_id, member_name, range_key, level`;

  const chunkSize = getSyncBulkChunkSize();
  const out: UpsertedWarning[] = [];
  for (let offset = 0; offset < inputs.length; offset += chunkSize) {
    const params = [JSON.stringify(toPayload(inputs.slice(offset, offset + chunkSize)))];
    out.push(...(await executorQuery<UpsertedWarning>(db, sql, params)));
  }
  return out;
}

/**
 * How long each warning has already been running, as of the month before this
 * one. Keyed by (URL, member, range) so the evaluator can count a streak without
 * a query per candidate.
 *
 * Reads the immediately preceding calendar month only. A gap month means the
 * streak broke, and a streak that survives a month of not triggering is not a
 * streak.
 */
export async function getPriorConsecutiveCounts(
  evaluationMonth: string,
  db?: DbExecutor,
): Promise<Map<string, number>> {
  const rows = await executorQuery<{
    content_url_id: string;
    member_name: string;
    range_key: string;
    consecutive_count: number;
  }>(
    db,
    `select content_url_id, member_name, range_key, max(consecutive_count) as consecutive_count
       from public.url_kpi_warnings
      where evaluation_month = ($1::date - interval '1 month')::date
      group by content_url_id, member_name, range_key`,
    [evaluationMonth],
  );
  return new Map(
    rows.map((row) => [
      warningKey({ contentUrlId: row.content_url_id, memberName: row.member_name, rangeKey: row.range_key }),
      Number(row.consecutive_count),
    ]),
  );
}

/**
 * Close out warnings that did not fire again this month.
 *
 * "Recovered" is the honest label and the useful one: the rate at which warnings
 * resolve themselves within a couple of closed months, with nothing actionable
 * found, is the measurement that tells the team whether these thresholds are
 * catching real problems or just noise.
 *
 * Warnings already attached to an audit are left alone — that case is answered
 * when the audit closes, not when the traffic happens to bounce.
 */
export async function resolveStaleWarnings(evaluationMonth: string, db?: DbExecutor): Promise<number> {
  const rows = await executorQuery<{ id: string }>(
    db,
    `update public.url_kpi_warnings w
        set resolved_at = now(), resolution = 'recovered', updated_at = now()
      where w.resolved_at is null
        and w.audit_id is null
        and w.evaluation_month < $1::date
        and not exists (
          select 1 from public.url_kpi_warnings current
           where current.evaluation_month = $1::date
             and current.content_url_id = w.content_url_id
             and current.member_name = w.member_name
             and current.range_key = w.range_key
        )
      returning w.id`,
    [evaluationMonth],
  );
  return rows.length;
}

/**
 * The warning queue. Ordered by KPI drag, not by row count — the same reason the
 * audit queue is.
 */
export async function listWarningQueue(filters: {
  evaluationMonth?: string;
  memberName?: string;
  project?: string;
  rangeKey?: WarningRangeKey;
  level?: WarningLevel;
  openOnly?: boolean;
}): Promise<WarningQueueRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (fragment: (placeholder: string) => string, value: unknown) => {
    params.push(value);
    conditions.push(fragment(`$${params.length}`));
  };

  if (filters.evaluationMonth) add((p) => `w.evaluation_month = ${p}::date`, filters.evaluationMonth);
  if (filters.memberName) add((p) => `w.member_name = ${p}`, filters.memberName);
  if (filters.project) add((p) => `c.project = ${p}`, filters.project);
  if (filters.rangeKey) add((p) => `w.range_key = ${p}`, filters.rangeKey);
  if (filters.level) add((p) => `w.level = ${p}`, filters.level);
  if (filters.openOnly) conditions.push("w.resolved_at is null");

  return query<WarningQueueRow>(
    `select w.*, c.url, c.project, a.status as audit_status, a.sla_deadline as audit_sla_deadline
       from public.url_kpi_warnings w
       join public.content_urls c on c.id = w.content_url_id
       left join public.url_kpi_audits a on a.id = w.audit_id
      ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
      order by w.kpi_drag_points desc, w.evaluation_month desc`,
    params,
  );
}

/** One member's own warnings, newest evaluation first. Read-only by design. */
export async function listWarningsForMember(memberName: string, limit = 100): Promise<WarningQueueRow[]> {
  return query<WarningQueueRow>(
    `select w.*, c.url, c.project, a.status as audit_status, a.sla_deadline as audit_sla_deadline
       from public.url_kpi_warnings w
       join public.content_urls c on c.id = w.content_url_id
       left join public.url_kpi_audits a on a.id = w.audit_id
      where w.member_name = $1
      order by w.resolved_at is not null, w.kpi_drag_points desc, w.evaluation_month desc
      limit $2`,
    [memberName, limit],
  );
}

export async function listWarningsForAudit(auditId: string): Promise<WarningQueueRow[]> {
  return query<WarningQueueRow>(
    `select w.*, c.url, c.project, a.status as audit_status, a.sla_deadline as audit_sla_deadline
       from public.url_kpi_warnings w
       join public.content_urls c on c.id = w.content_url_id
       left join public.url_kpi_audits a on a.id = w.audit_id
      where w.audit_id = $1
      order by w.kpi_drag_points desc`,
    [auditId],
  );
}

/** The distinct months an evaluation has ever been recorded for, newest first. */
export async function listEvaluationMonths(limit = 12): Promise<string[]> {
  const rows = await query<{ evaluation_month: string }>(
    "select distinct evaluation_month from public.url_kpi_warnings order by evaluation_month desc limit $1",
    [limit],
  );
  return rows.map((row) => row.evaluation_month);
}
