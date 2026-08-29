import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canApprove, getAuditRole } from "@/lib/repositories/kpi-audit-roles";
import { applyAuditAction, listAuditEvents } from "@/lib/repositories/url-kpi-audits";
import { listWarningsForAudit } from "@/lib/repositories/url-kpi-warnings";

/**
 * Sign off on someone else's conclusion.
 *
 * Two conditions, refused here with an explanation and again by the database as
 * a CHECK constraint: the approver must hold the role, and must not be the person
 * who proposed it. Approving still changes no score — it records that the team
 * reached an answer, which is the whole of what this phase does with one.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/admin/kpi/audits/[id]/approve">) {
  const { id } = await ctx.params;
  const session = await getServerSession(authOptions);
  const actor = session?.user?.email ?? null;
  if (!actor) return NextResponse.json({ error: "Approving requires a signed-in account" }, { status: 403 });

  const result = await applyAuditAction(id, "approve", {}, actor, {
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
