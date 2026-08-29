import type { QueryResultRow } from "pg";
import { withTransaction, query, type DbExecutor } from "@/lib/db";
import {
  AUDIT_EVENT_FOR_ACTION,
  EXTERNAL_SHARE_BY_CONCLUSION,
  checkTransition,
  slaDeadlineFrom,
  statusAfter,
  type AuditAction,
  type AuditConclusion,
  type AuditEventType,
  type AuditState,
  type AuditStatus,
} from "@/lib/performance/audit-workflow";
import type { AuditEvidence } from "@/lib/performance/audit-evidence";
import { AUDIT_POLICY_VERSION } from "@/lib/performance/warning";

export interface UrlKpiAuditRow {
  id: string;
  content_url_id: string;
  status: AuditStatus;
  conclusion: AuditConclusion | null;
  external_share: number | null;
  cause_start_date: string | null;
  cause_end_date: string | null;
  evidence: AuditEvidence | null;
  confidence_note: string | null;
  proposed_by: string | null;
  proposed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  opened_by: string | null;
  opened_at: string;
  sla_deadline: string;
  resolved_at: string | null;
  policy_version: string;
  created_at: string;
  updated_at: string;
}

export interface AuditQueueRow extends UrlKpiAuditRow {
  url: string;
  project: string;
  /** Every member the linked warnings hold accountable, comma-joined for display. */
  affected_members: string | null;
  /** The largest single-member drag among the linked warnings — what the queue sorts on. */
  max_kpi_drag_points: number | null;
  warning_count: number;
}

export interface UrlKpiAuditEventRow {
  id: string;
  audit_id: string;
  content_url_id: string;
  event_type: AuditEventType;
  previous_state: Record<string, unknown> | null;
  next_state: Record<string, unknown> | null;
  actor_id: string;
  occurred_at: string;
  policy_version: string;
  detail: Record<string, unknown> | null;
}

function executorQuery<T extends QueryResultRow>(
  db: DbExecutor | undefined,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  return db ? db.query<T>(text, params).then((r) => r.rows) : query<T>(text, params);
}

/**
 * Append one row to the audit log. There is no counterpart that edits or removes
 * one, here or anywhere else — a database trigger refuses both, so the absence
 * of those functions is the API surface matching what the storage will accept.
 */
async function appendEvent(
  db: DbExecutor,
  input: {
    auditId: string;
    contentUrlId: string;
    eventType: AuditEventType;
    previousState: unknown;
    nextState: unknown;
    actorId: string;
    detail?: unknown;
  },
): Promise<void> {
  await db.query(
    `insert into public.url_kpi_audit_events
       (audit_id, content_url_id, event_type, previous_state, next_state, actor_id, policy_version, detail)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::jsonb)`,
    [
      input.auditId,
      input.contentUrlId,
      input.eventType,
      input.previousState == null ? null : JSON.stringify(input.previousState),
      input.nextState == null ? null : JSON.stringify(input.nextState),
      input.actorId,
      AUDIT_POLICY_VERSION,
      input.detail === undefined ? null : JSON.stringify(input.detail),
    ],
  );
}

/** The subset of a row the workflow rules actually reason about. */
function stateOf(row: UrlKpiAuditRow): AuditState {
  return {
    status: row.status,
    conclusion: row.conclusion,
    proposedBy: row.proposed_by,
    hasEvidence: row.evidence !== null,
    hasConfidenceNote: Boolean(row.confidence_note && row.confidence_note.trim()),
  };
}

/** What an event records as before/after. Small on purpose — the row itself is the detail. */
function snapshotOf(row: UrlKpiAuditRow) {
  return {
    status: row.status,
    conclusion: row.conclusion,
    external_share: row.external_share,
    proposed_by: row.proposed_by,
    approved_by: row.approved_by,
    resolved_at: row.resolved_at,
  };
}

export interface OpenAuditInput {
  contentUrlId: string;
  openedBy: string | null;
  slaDays: number;
  /** Free-form context for the opening event — e.g. which warning triggered it. */
  detail?: unknown;
}

/**
 * Open a case, or hand back the one already open for this URL.
 *
 * Cause is investigated per URL, so a second case for a URL already under
 * investigation is duplicated work, not extra rigour. The partial unique index
 * is what actually guarantees it; this returns the existing row rather than
 * raising, because the evaluator's correct response to "already open" is to link
 * its warning to that case and move on.
 */
export async function openAudit(
  input: OpenAuditInput,
  db: DbExecutor,
): Promise<{ audit: UrlKpiAuditRow; created: boolean }> {
  const existing = await executorQuery<UrlKpiAuditRow>(
    db,
    `select * from public.url_kpi_audits
      where content_url_id = $1 and status in ('needs_audit', 'in_progress')
      limit 1`,
    [input.contentUrlId],
  );
  if (existing[0]) return { audit: existing[0], created: false };

  const deadline = slaDeadlineFrom(new Date(), input.slaDays);
  const inserted = await executorQuery<UrlKpiAuditRow>(
    db,
    `insert into public.url_kpi_audits (content_url_id, opened_by, sla_deadline, policy_version)
     values ($1, $2, $3, $4)
     returning *`,
    [input.contentUrlId, input.openedBy, deadline.toISOString(), AUDIT_POLICY_VERSION],
  );
  const audit = inserted[0];

  await appendEvent(db, {
    auditId: audit.id,
    contentUrlId: audit.content_url_id,
    eventType: "opened",
    previousState: null,
    nextState: snapshotOf(audit),
    actorId: input.openedBy ?? "system",
    detail: input.detail,
  });

  return { audit, created: true };
}

export async function getAuditById(id: string): Promise<UrlKpiAuditRow | null> {
  const rows = await query<UrlKpiAuditRow>("select * from public.url_kpi_audits where id = $1", [id]);
  return rows[0] ?? null;
}

/**
 * The queue, ordered by what it costs rather than by how many rows there are.
 *
 * Working the list by URL count treats a URL dragging 0.1 points the same as one
 * dragging 4. Ordering by the worst single-member drag puts the finite auditing
 * hours where the KPI actually moves.
 */
export async function listAuditQueue(filters: {
  status?: AuditStatus[];
  project?: string;
  memberName?: string;
}): Promise<AuditQueueRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status?.length) {
    params.push(filters.status);
    conditions.push(`a.status = any($${params.length}::text[])`);
  }
  if (filters.project) {
    params.push(filters.project);
    conditions.push(`c.project = $${params.length}`);
  }
  if (filters.memberName) {
    params.push(filters.memberName);
    conditions.push(`exists (select 1 from public.url_kpi_warnings w
                              where w.audit_id = a.id and w.member_name = $${params.length})`);
  }

  return query<AuditQueueRow>(
    `select a.*, c.url, c.project,
            agg.affected_members, agg.max_kpi_drag_points, coalesce(agg.warning_count, 0) as warning_count
       from public.url_kpi_audits a
       join public.content_urls c on c.id = a.content_url_id
       left join lateral (
         select string_agg(distinct w.member_name, ', ') as affected_members,
                max(w.kpi_drag_points) as max_kpi_drag_points,
                count(*) as warning_count
           from public.url_kpi_warnings w
          where w.audit_id = a.id
       ) agg on true
      ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
      order by agg.max_kpi_drag_points desc nulls last, a.sla_deadline asc`,
    params,
  );
}

export async function listAuditEvents(auditId: string): Promise<UrlKpiAuditEventRow[]> {
  return query<UrlKpiAuditEventRow>(
    "select * from public.url_kpi_audit_events where audit_id = $1 order by occurred_at, id",
    [auditId],
  );
}

export interface AuditActionPatch {
  conclusion?: AuditConclusion | null;
  causeStartDate?: string | null;
  causeEndDate?: string | null;
  evidence?: AuditEvidence | null;
  confidenceNote?: string | null;
}

export interface AuditActionResult {
  audit: UrlKpiAuditRow | null;
  error: string | null;
}

/**
 * Apply one workflow action, writing the row and its log entry in the same
 * transaction. Either both land or neither does: a state change with no event
 * behind it is exactly the hole an append-only log exists to prevent.
 *
 * The row is locked FOR UPDATE before the rules are checked, so two approvers
 * clicking at once cannot both read "proposed, not yet approved" and both win.
 *
 * Note what this function cannot do: none of its actions touch a score. In this
 * phase there is no adjustment table for it to write to, which is what makes
 * "the workflow never changes a KPI" a structural fact rather than a promise.
 */
export async function applyAuditAction(
  id: string,
  action: AuditAction,
  patch: AuditActionPatch,
  actor: string | null,
  options: { canApprove: boolean },
): Promise<AuditActionResult> {
  return withTransaction(async (client) => {
    const locked = await client.query<UrlKpiAuditRow>(
      "select * from public.url_kpi_audits where id = $1 for update",
      [id],
    );
    const current = locked.rows[0];
    if (!current) return { audit: null, error: "Audit not found" };

    // Evidence and conclusion arrive in the same request that proposes them, so
    // the rules have to be checked against the state the action would produce,
    // not the state on disk.
    const merged: UrlKpiAuditRow = {
      ...current,
      conclusion: patch.conclusion !== undefined ? patch.conclusion : current.conclusion,
      evidence: patch.evidence !== undefined ? patch.evidence : current.evidence,
      confidence_note: patch.confidenceNote !== undefined ? patch.confidenceNote : current.confidence_note,
    };

    const proposedState: AuditState =
      action === "propose" ? { ...stateOf(merged), proposedBy: actor } : stateOf(merged);

    const error = checkTransition(proposedState, action, actor, options);
    if (error) return { audit: null, error };

    const nextStatus = statusAfter(action, current.status);
    const now = new Date().toISOString();

    // Column by column, per action. One generic patch would let "update evidence"
    // quietly carry an approval along in the same body.
    const sets: string[] = ["status = $2", "updated_at = now()"];
    const params: unknown[] = [id, nextStatus];
    const push = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (action === "update_evidence" || action === "propose") {
      if (patch.conclusion !== undefined) {
        push("conclusion", patch.conclusion);
        push("external_share", patch.conclusion === null ? null : EXTERNAL_SHARE_BY_CONCLUSION[patch.conclusion]);
      }
      if (patch.causeStartDate !== undefined) push("cause_start_date", patch.causeStartDate);
      if (patch.causeEndDate !== undefined) push("cause_end_date", patch.causeEndDate);
      if (patch.evidence !== undefined) {
        params.push(patch.evidence === null ? null : JSON.stringify(patch.evidence));
        sets.push(`evidence = $${params.length}::jsonb`);
      }
      if (patch.confidenceNote !== undefined) push("confidence_note", patch.confidenceNote);
    }

    if (action === "propose") {
      push("proposed_by", actor);
      push("proposed_at", now);
      // A fresh proposal supersedes any earlier approval on the same case.
      sets.push("approved_by = null", "approved_at = null", "resolved_at = null");
    }

    if (action === "approve") {
      push("approved_by", actor);
      push("approved_at", now);
      push("resolved_at", now);
    }

    if (action === "reject") {
      // The proposal goes with it. What is left is an open case holding the
      // evidence gathered so far, which is what "rejected" ought to mean.
      sets.push("conclusion = null", "external_share = null", "proposed_by = null", "proposed_at = null");
      sets.push("approved_by = null", "approved_at = null", "resolved_at = null");
    }

    if (action === "cancel") push("resolved_at", now);

    if (action === "reopen") {
      sets.push("conclusion = null", "external_share = null", "proposed_by = null", "proposed_at = null");
      sets.push("approved_by = null", "approved_at = null", "resolved_at = null");
    }

    const updated = await client.query<UrlKpiAuditRow>(
      `update public.url_kpi_audits set ${sets.join(", ")} where id = $1 returning *`,
      params,
    );
    const audit = updated.rows[0];

    await appendEvent(client, {
      auditId: audit.id,
      contentUrlId: audit.content_url_id,
      eventType: AUDIT_EVENT_FOR_ACTION[action],
      previousState: snapshotOf(current),
      nextState: snapshotOf(audit),
      actorId: actor ?? "system",
    });

    // A closed case closes the warnings that pointed at it, so the same impact is
    // not re-queued next month under a case that has already been answered.
    if (nextStatus === "resolved" || nextStatus === "cancelled") {
      await client.query(
        `update public.url_kpi_warnings
            set resolved_at = now(), resolution = 'audit_resolved', updated_at = now()
          where audit_id = $1 and resolved_at is null`,
        [audit.id],
      );
    }

    return { audit, error: null };
  });
}

/** Attach a warning to the case that answers it, and say so in the log. */
export async function linkWarningToAudit(
  db: DbExecutor,
  input: { warningId: string; auditId: string; contentUrlId: string; actorId: string; detail?: unknown },
): Promise<void> {
  const updated = await executorQuery<{ id: string }>(
    db,
    `update public.url_kpi_warnings set audit_id = $2, updated_at = now()
      where id = $1 and (audit_id is null or audit_id <> $2)
      returning id`,
    [input.warningId, input.auditId],
  );
  if (updated.length === 0) return;

  await appendEvent(db, {
    auditId: input.auditId,
    contentUrlId: input.contentUrlId,
    eventType: "warning_linked",
    previousState: null,
    nextState: { warning_id: input.warningId },
    actorId: input.actorId,
    detail: input.detail,
  });
}
