"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuditEvidenceForm } from "@/components/AuditEvidenceForm";
import { Badge, Button, Card, CardHeader, EmptyState } from "@/components/ui";
import {
  AUDIT_CONCLUSION_LABELS,
  AUDIT_EVENT_LABELS,
  AUDIT_STATUS_LABELS,
  RANGE_SHORT_LABELS,
  WARNING_LEVEL_LABELS,
  formatDate,
  formatDragPoints,
  formatMonth,
  formatScore,
  formatSlaRemaining,
} from "@/lib/format";
import { emptyEvidence, missingEvidenceFields, type AuditEvidence } from "@/lib/performance/audit-evidence";
import { slaBreached, type AuditConclusion, type AuditStatus } from "@/lib/performance/audit-workflow";

// Declared here rather than imported from the repositories: those modules pull in
// the Postgres client, which has no business in a browser bundle.
export interface AuditDetail {
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
  approved_by: string | null;
  opened_by: string | null;
  opened_at: string;
  sla_deadline: string;
  resolved_at: string | null;
}

interface AuditWarning {
  id: string;
  member_name: string;
  range_key: string;
  level: string;
  evaluation_month: string;
  kpi_drag_points: number;
  raw_score_snapshot: number | null;
}

interface AuditEvent {
  id: string;
  event_type: string;
  actor_id: string;
  occurred_at: string;
}

interface Viewer {
  email: string | null;
  role: string | null;
}

interface DetailBody {
  audit: AuditDetail;
  warnings: AuditWarning[];
  events: AuditEvent[];
  viewer?: Viewer;
}

const OPEN_STATUSES: AuditStatus[] = ["needs_audit", "in_progress"];

export function AuditDetailPanel({ auditId, onChanged }: { auditId: string; onChanged: () => void }) {
  const [audit, setAudit] = useState<AuditDetail | null>(null);
  const [warnings, setWarnings] = useState<AuditWarning[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [viewer, setViewer] = useState<Viewer>({ email: null, role: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  // Draft state, so a half-written evidence package survives a re-render.
  const [evidence, setEvidence] = useState<AuditEvidence>(emptyEvidence());
  const [conclusion, setConclusion] = useState<AuditConclusion | null>(null);
  const [confidenceNote, setConfidenceNote] = useState("");
  const [causeStart, setCauseStart] = useState("");
  const [causeEnd, setCauseEnd] = useState("");

  const applyDetail = useCallback((body: DetailBody) => {
    setAudit(body.audit);
    setWarnings(body.warnings ?? []);
    setEvents(body.events ?? []);
    if (body.viewer) setViewer(body.viewer);
    setEvidence({ ...emptyEvidence(), ...(body.audit.evidence ?? {}) });
    setConclusion(body.audit.conclusion);
    setConfidenceNote(body.audit.confidence_note ?? "");
    setCauseStart(body.audit.cause_start_date ?? "");
    setCauseEnd(body.audit.cause_end_date ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    fetch(`/api/admin/kpi/audits/${auditId}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not load this audit");
        return body as DetailBody;
      })
      .then((body) => {
        if (!cancelled) applyDetail(body);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setAudit(null);
        setMessage({ text: err.message, failed: true });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auditId, applyDetail]);

  const missing = useMemo(
    () => new Set(missingEvidenceFields(evidence, conclusion).map((f) => f.key as string)),
    [evidence, conclusion],
  );

  const send = useCallback(
    async (path: string, init: RequestInit, successText: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await fetch(path, init);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "That did not work");
        applyDetail(body as DetailBody);
        setMessage({ text: successText, failed: false });
        onChanged();
      } catch (err) {
        setMessage({ text: (err as Error).message, failed: true });
      } finally {
        setBusy(false);
      }
    },
    [applyDetail, onChanged],
  );

  const patch = (action: string, extra: Record<string, unknown> = {}, successText = "Saved.") =>
    send(
      `/api/admin/kpi/audits/${auditId}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) },
      successText,
    );

  const post = (segment: string, successText: string) =>
    send(`/api/admin/kpi/audits/${auditId}/${segment}`, { method: "POST" }, successText);

  if (loading) return <p className="px-5 py-10 text-center text-sm text-ink-muted">Loading audit…</p>;
  if (!audit) return <EmptyState title="This audit could not be loaded" hint={message?.text} />;

  const draft = {
    conclusion,
    confidenceNote,
    causeStartDate: causeStart || null,
    causeEndDate: causeEnd || null,
    evidence,
  };

  const isOpen = OPEN_STATUSES.includes(audit.status);
  const canApproveRole = viewer.role === "approver" || viewer.role === "lead";
  const isProposer =
    audit.proposed_by !== null && viewer.email !== null
    && audit.proposed_by.trim().toLowerCase() === viewer.email.trim().toLowerCase();
  const hasProposal = audit.conclusion !== null && audit.proposed_by !== null;
  const overdue = slaBreached(audit.sla_deadline, audit.resolved_at);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`Audit — ${AUDIT_STATUS_LABELS[audit.status] ?? audit.status}`}
          description={`Opened ${formatDate(audit.opened_at)} by ${audit.opened_by ?? "the system"} · SLA ${formatSlaRemaining(audit.sla_deadline, audit.resolved_at)}`}
          action={
            <div className="flex items-center gap-2">
              {overdue && <Badge tone="negative">Past SLA</Badge>}
              {audit.conclusion && (
                <Badge tone={audit.approved_by ? "positive" : "warning"}>
                  {AUDIT_CONCLUSION_LABELS[audit.conclusion]}
                  {audit.approved_by ? "" : " (proposed)"}
                </Badge>
              )}
            </div>
          }
        />
        <div className="space-y-4 px-5 py-4">
          <p className="text-[13px] leading-5 text-ink-subtle">
            Being past SLA measures how the queue is worked. It changes no score, and neither does resolving this case.
          </p>
          {warnings.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-neutral-soft/60 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    <th className="px-3 py-2 text-left">Member</th>
                    <th className="px-3 py-2 text-left">Range</th>
                    <th className="px-3 py-2 text-left">Month</th>
                    <th className="px-3 py-2 text-left">Level</th>
                    <th className="px-3 py-2 text-right">Score</th>
                    <th className="px-3 py-2 text-right">KPI drag</th>
                  </tr>
                </thead>
                <tbody>
                  {warnings.map((warning) => (
                    <tr key={warning.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">{warning.member_name}</td>
                      <td className="px-3 py-2">{RANGE_SHORT_LABELS[warning.range_key] ?? warning.range_key}</td>
                      <td className="px-3 py-2">{formatMonth(warning.evaluation_month)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={warning.level === "mandatory_audit" ? "negative" : "warning"}>
                          {WARNING_LEVEL_LABELS[warning.level] ?? warning.level}
                        </Badge>
                      </td>
                      <td className="numeric px-3 py-2 text-right">{formatScore(warning.raw_score_snapshot)}</td>
                      <td className="numeric px-3 py-2 text-right">{formatDragPoints(warning.kpi_drag_points)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Evidence"
          description="Every question has to be answered before a conclusion can reduce accountability."
        />
        <div className="px-5 py-4">
          <AuditEvidenceForm
            evidence={evidence}
            conclusion={conclusion}
            confidenceNote={confidenceNote}
            causeStartDate={causeStart}
            causeEndDate={causeEnd}
            missingKeys={missing}
            disabled={!isOpen || busy}
            onEvidenceChange={(key, value) => setEvidence((prev) => ({ ...prev, [key]: value }))}
            onConclusionChange={setConclusion}
            onConfidenceNoteChange={setConfidenceNote}
            onCauseChange={(which, value) => (which === "start" ? setCauseStart(value) : setCauseEnd(value))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4">
          {audit.status === "needs_audit" && (
            <Button variant="secondary" disabled={busy} onClick={() => patch("claim", {}, "Claimed.")}>
              Claim
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={!isOpen || busy}
            onClick={() => patch("update_evidence", draft, "Evidence saved.")}
          >
            Save evidence
          </Button>
          <Button
            disabled={!isOpen || busy || conclusion === null}
            onClick={() => patch("propose", draft, "Conclusion proposed.")}
          >
            Propose conclusion
          </Button>
          {hasProposal && (
            <>
              <Button
                disabled={busy || !canApproveRole || isProposer || audit.status !== "in_progress"}
                onClick={() => post("approve", "Approved.")}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                disabled={busy || !canApproveRole || audit.status !== "in_progress"}
                onClick={() => post("reject", "Sent back to the auditor.")}
              >
                Send back
              </Button>
            </>
          )}
          {!isOpen && (
            <Button variant="secondary" disabled={busy || !canApproveRole} onClick={() => post("reopen", "Reopened.")}>
              Reopen
            </Button>
          )}
          {isOpen && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Cancel this audit? The event log keeps the record either way.")) {
                  patch("cancel", {}, "Cancelled.");
                }
              }}
            >
              Cancel case
            </Button>
          )}
        </div>
        {hasProposal && isProposer && (
          <p className="border-t border-line px-5 py-3 text-[13px] text-ink-subtle">
            You proposed this conclusion, so someone else has to approve it.
          </p>
        )}
        {hasProposal && !canApproveRole && !isProposer && (
          <p className="border-t border-line px-5 py-3 text-[13px] text-ink-subtle">
            Approving needs the approver or lead role, granted in Admin &rarr; Settings.
          </p>
        )}
        {message && (
          <p className={`border-t border-line px-5 py-3 text-[13px] ${message.failed ? "text-negative" : "text-ink-muted"}`}>
            {message.text}
          </p>
        )}
      </Card>

      <Card>
        <CardHeader title="History" description="Append-only. Nothing here can be edited or removed, by anyone." />
        {events.length === 0 ? (
          <EmptyState title="No events yet" />
        ) : (
          <ol className="divide-y divide-line">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                <span className="text-ink">{AUDIT_EVENT_LABELS[event.event_type] ?? event.event_type}</span>
                <span className="text-[13px] text-ink-muted">
                  {event.actor_id} · {formatDate(event.occurred_at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
