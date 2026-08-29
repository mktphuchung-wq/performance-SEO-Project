import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canApprove, getAuditRole } from "@/lib/repositories/kpi-audit-roles";
import { applyAuditAction, listAuditEvents } from "@/lib/repositories/url-kpi-audits";
import { listWarningsForAudit } from "@/lib/repositories/url-kpi-warnings";

/**
 * Reopen a closed case when new evidence turns up.
 *
 * The conclusion and its approval are cleared rather than edited: a decision
 * that has been questioned should be made again in full, and the original
 * remains readable in the event log either way.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/admin/kpi/audits/[id]/reopen">) {
  const { id } = await ctx.params;
  const session = await getServerSession(authOptions);
  const actor = session?.user?.email ?? null;
  if (!actor) return NextResponse.json({ error: "Reopening requires a signed-in account" }, { status: 403 });

  const result = await applyAuditAction(id, "reopen", {}, actor, {
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
