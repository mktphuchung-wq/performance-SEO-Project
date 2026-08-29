import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canApprove, getAuditRole } from "@/lib/repositories/kpi-audit-roles";
import { applyAuditAction, listAuditEvents } from "@/lib/repositories/url-kpi-audits";
import { listWarningsForAudit } from "@/lib/repositories/url-kpi-warnings";

/**
 * Send a proposed conclusion back. The case stays open and keeps the evidence
 * gathered so far; only the proposal is withdrawn, so the next attempt starts
 * from the work already done rather than from nothing.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/admin/kpi/audits/[id]/reject">) {
  const { id } = await ctx.params;
  const session = await getServerSession(authOptions);
  const actor = session?.user?.email ?? null;
  if (!actor) return NextResponse.json({ error: "Rejecting requires a signed-in account" }, { status: 403 });

  const result = await applyAuditAction(id, "reject", {}, actor, {
    canApprove: canApprove(await getAuditRole(actor)),
  });
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.error === "Audit not found" ? 404 : 400 });
  }

  return NextResponse.json({
    audit: result.audit,
    warnings: await listWarningsForAudit(id),
    events: await listAuditEvents(id),
  });
}
