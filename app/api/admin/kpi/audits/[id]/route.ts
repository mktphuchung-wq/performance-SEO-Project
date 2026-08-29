import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { missingEvidenceFields, normalizeEvidence } from "@/lib/performance/audit-evidence";
import { isAuditConclusion, type AuditAction } from "@/lib/performance/audit-workflow";
import { canApprove, getAuditRole } from "@/lib/repositories/kpi-audit-roles";
import { applyAuditAction, getAuditById, listAuditEvents } from "@/lib/repositories/url-kpi-audits";
import { listWarningsForAudit } from "@/lib/repositories/url-kpi-warnings";

/** The actions this route accepts. approve/reject/reopen have routes of their own. */
const PATCH_ACTIONS: AuditAction[] = ["claim", "update_evidence", "propose", "cancel"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(_req: Request, ctx: RouteContext<"/api/admin/kpi/audits/[id]">) {
  const { id } = await ctx.params;
  const audit = await getAuditById(id);
  if (!audit) return NextResponse.json({ error: "Audit not found" }, { status: 404 });

  const session = await getServerSession(authOptions);
  return NextResponse.json({
    audit,
    warnings: await listWarningsForAudit(id),
    events: await listAuditEvents(id),
    viewer: {
      email: session?.user?.email ?? null,
      role: await getAuditRole(session?.user?.email ?? null),
    },
  });
}

/**
 * Claim a case, record evidence against it, propose a conclusion, or cancel it.
 *
 * Every one of these writes an append-only event alongside the row, in the same
 * transaction. None of them changes a score — there is no adjustment table for
 * them to write to yet, which is what makes that a structural fact rather than a
 * promise this handler has to keep.
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/kpi/audits/[id]">) {
  const { id } = await ctx.params;
  const session = await getServerSession(authOptions);
  const actor = session?.user?.email ?? null;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const action = body.action;
  if (typeof action !== "string" || !PATCH_ACTIONS.includes(action as AuditAction)) {
    return NextResponse.json({ error: `action must be one of ${PATCH_ACTIONS.join(", ")}` }, { status: 400 });
  }

  const patch: Parameters<typeof applyAuditAction>[2] = {};

  if (body.conclusion !== undefined) {
    if (body.conclusion !== null && !isAuditConclusion(body.conclusion)) {
      return NextResponse.json({ error: "conclusion is not one of the four allowed values" }, { status: 400 });
    }
    patch.conclusion = body.conclusion as typeof patch.conclusion;
  }
  for (const [key, column] of [["causeStartDate", "cause start date"], ["causeEndDate", "cause end date"]] as const) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && (typeof body[key] !== "string" || !ISO_DATE.test(body[key] as string))) {
      return NextResponse.json({ error: `${column} must be YYYY-MM-DD` }, { status: 400 });
    }
    patch[key] = body[key] as string | null;
  }
  if (patch.causeStartDate && patch.causeEndDate && patch.causeEndDate < patch.causeStartDate) {
    return NextResponse.json({ error: "The cause window cannot end before it starts" }, { status: 400 });
  }
  if (body.evidence !== undefined) patch.evidence = normalizeEvidence(body.evidence);
  if (body.confidenceNote !== undefined) {
    patch.confidenceNote = typeof body.confidenceNote === "string" && body.confidenceNote.trim()
      ? body.confidenceNote.trim()
      : null;
  }

  const existing = await getAuditById(id);
  if (!existing) return NextResponse.json({ error: "Audit not found" }, { status: 404 });

  // Name the blanks before the state machine gives its blunter "needs an evidence
  // package" — an auditor should be told which questions are still unanswered.
  if (action === "propose") {
    const conclusion = patch.conclusion !== undefined ? patch.conclusion : existing.conclusion;
    const evidence = patch.evidence !== undefined ? patch.evidence : existing.evidence;
    const missing = missingEvidenceFields(evidence ?? null, conclusion ?? null);
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `A ${conclusion} conclusion needs: ${missing.map((f) => f.label).join(", ")}` },
        { status: 400 },
      );
    }
  }

  const role = await getAuditRole(actor);
  const result = await applyAuditAction(id, action as AuditAction, patch, actor, { canApprove: canApprove(role) });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({
    audit: result.audit,
    warnings: await listWarningsForAudit(id),
    events: await listAuditEvents(id),
  });
}
