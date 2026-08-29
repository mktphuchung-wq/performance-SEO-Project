import { NextResponse } from "next/server";
import { getAuditById, listAuditEvents } from "@/lib/repositories/url-kpi-audits";

/** The append-only history of one case. Read-only — there is no write path anywhere. */
export async function GET(_req: Request, ctx: RouteContext<"/api/admin/kpi/audits/[id]/events">) {
  const { id } = await ctx.params;
  if (!(await getAuditById(id))) return NextResponse.json({ error: "Audit not found" }, { status: 404 });
  return NextResponse.json({ events: await listAuditEvents(id) });
}
