export type AuditStatus = "needs_audit" | "in_progress" | "resolved" | "cancelled";

export type AuditConclusion = "controllable" | "external_verified" | "mixed" | "insufficient_evidence";

export type AuditAction = "claim" | "update_evidence" | "propose" | "approve" | "reject" | "cancel" | "reopen";

export type AuditEventType =
  | "opened"
  | "claimed"
  | "evidence_updated"
  | "proposed"
  | "approved"
  | "rejected"
  | "reopened"
  | "cancelled"
  | "warning_linked";

export const AUDIT_STATUSES: AuditStatus[] = ["needs_audit", "in_progress", "resolved", "cancelled"];

export const AUDIT_CONCLUSIONS: AuditConclusion[] = [
  "controllable",
  "external_verified",
  "mixed",
  "insufficient_evidence",
];

/**
 * The whole of the conclusion-to-number mapping, in one place.
 *
 * Three levels, not a slider. An auditor cannot express "37% external" because
 * no evidence package this workflow can realistically produce supports that
 * second digit, and a number that looks more precise than its evidence is a
 * number people stop arguing with.
 *
 * The default leans accountable in both directions that matter: no conclusion
 * and insufficient evidence both come out at 0. Failing to prove an external
 * cause is not the same as proving there wasn't one, and this treats it the same
 * as if there wasn't — on purpose.
 */
export const EXTERNAL_SHARE_BY_CONCLUSION: Record<AuditConclusion, number> = {
  controllable: 0,
  external_verified: 1,
  mixed: 0.5,
  insufficient_evidence: 0,
};

/** The conclusions that would reduce accountability, and so have to be argued for. */
export const CONCLUSIONS_REQUIRING_EVIDENCE: AuditConclusion[] = ["external_verified", "mixed"];

export interface AuditState {
  status: AuditStatus;
  conclusion: AuditConclusion | null;
  proposedBy: string | null;
  hasEvidence: boolean;
  hasConfidenceNote: boolean;
}

const NEXT_STATUS: Record<AuditAction, AuditStatus | null> = {
  claim: "in_progress",
  update_evidence: null, // stays put
  propose: "in_progress",
  approve: "resolved",
  reject: "in_progress",
  cancel: "cancelled",
  reopen: "in_progress",
};

const ALLOWED_FROM: Record<AuditAction, AuditStatus[]> = {
  claim: ["needs_audit"],
  update_evidence: ["needs_audit", "in_progress"],
  propose: ["needs_audit", "in_progress"],
  approve: ["in_progress"],
  reject: ["in_progress"],
  cancel: ["needs_audit", "in_progress"],
  reopen: ["resolved", "cancelled"],
};

export const AUDIT_EVENT_FOR_ACTION: Record<AuditAction, AuditEventType> = {
  claim: "claimed",
  update_evidence: "evidence_updated",
  propose: "proposed",
  approve: "approved",
  reject: "rejected",
  cancel: "cancelled",
  reopen: "reopened",
};

export function statusAfter(action: AuditAction, current: AuditStatus): AuditStatus {
  return NEXT_STATUS[action] ?? current;
}

function sameActor(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether an action is legal from the state the audit is actually in. Returns a
 * human-readable reason when it is not, null when it is.
 *
 * Pure and DB-free so the rules can be tested exhaustively and so the API layer
 * and the UI can agree on what is possible without a round trip. The database
 * re-checks the two that matter most (a complete resolution, and a distinct
 * approver) as CHECK constraints — this is the layer that explains the refusal,
 * that one is the layer that guarantees it.
 */
export function checkTransition(
  state: AuditState,
  action: AuditAction,
  actor: string | null,
  options: { canApprove: boolean },
): string | null {
  if (!ALLOWED_FROM[action].includes(state.status)) {
    return `Cannot ${action.replace("_", " ")} an audit that is ${state.status}`;
  }

  if (action === "propose") {
    if (state.conclusion === null) return "A proposal needs a conclusion";
    if (CONCLUSIONS_REQUIRING_EVIDENCE.includes(state.conclusion)) {
      if (!state.hasEvidence) return `A ${state.conclusion} conclusion needs an evidence package`;
      if (!state.hasConfidenceNote) return `A ${state.conclusion} conclusion needs a confidence note`;
    }
  }

  if (action === "approve") {
    if (state.conclusion === null || state.proposedBy === null) {
      return "There is no proposed conclusion to approve";
    }
    // The rule the credibility of the whole workflow rests on. An auditor who
    // could sign off their own conclusion is just an auditor with extra steps.
    if (sameActor(actor, state.proposedBy)) {
      return "An audit cannot be approved by the person who proposed it";
    }
    if (!options.canApprove) {
      return "Approving needs the approver or lead role";
    }
  }

  if (action === "reject") {
    if (state.conclusion === null || state.proposedBy === null) {
      return "There is no proposed conclusion to reject";
    }
    if (!options.canApprove) return "Rejecting a proposal needs the approver or lead role";
  }

  if (action === "reopen" && !options.canApprove) {
    return "Reopening a closed audit needs the approver or lead role";
  }

  return null;
}

/**
 * Whether an audit missed its SLA — computed, never stored.
 *
 * A stored boolean would be wrong from the moment the deadline passed until
 * something happened to rewrite it, and would have to be maintained by a job
 * whose failure mode is silently under-reporting exactly the thing it exists to
 * report.
 *
 * Breaching the SLA changes nothing about anyone's score. It measures how the
 * team is running the queue, and that is all it measures.
 */
export function slaBreached(slaDeadline: Date | string, resolvedAt: Date | string | null, now: Date = new Date()): boolean {
  const deadline = typeof slaDeadline === "string" ? new Date(slaDeadline) : slaDeadline;
  if (Number.isNaN(deadline.getTime())) return false;
  const settled = resolvedAt === null ? null : typeof resolvedAt === "string" ? new Date(resolvedAt) : resolvedAt;
  return (settled ?? now).getTime() > deadline.getTime();
}

export function slaDeadlineFrom(openedAt: Date, slaDays: number): Date {
  return new Date(openedAt.getTime() + slaDays * 86_400_000);
}

export function isAuditConclusion(value: unknown): value is AuditConclusion {
  return typeof value === "string" && (AUDIT_CONCLUSIONS as string[]).includes(value);
}
