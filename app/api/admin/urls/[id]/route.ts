import { NextResponse } from "next/server";
import { getContentUrlById, setKpiExclusion } from "@/lib/repositories/content-urls";

// Next 16 hands route handlers `params` as a promise — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/urls/[id]">) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const existing = await getContentUrlById(id);
  if (!existing) {
    return NextResponse.json({ error: "URL not found" }, { status: 404 });
  }

  if (typeof body.kpiExcluded !== "boolean") {
    return NextResponse.json({ error: "kpiExcluded must be true or false" }, { status: 400 });
  }
  const reason = body.reason ? String(body.reason).trim() || null : null;

  await setKpiExclusion(id, body.kpiExcluded, reason);
  return NextResponse.json({ ok: true });
}
