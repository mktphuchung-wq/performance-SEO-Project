import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  listMonthlyMetricsForUrl,
  setMonthlyManualOverride,
  type ManualOverride,
} from "@/lib/repositories/content-url-monthly-metrics";
import { getContentUrlById } from "@/lib/repositories/content-urls";

const OVERRIDES: ManualOverride[] = ["force_exclude", "force_include"];

export async function GET(_req: Request, ctx: RouteContext<"/api/admin/urls/[id]/monthly-metrics">) {
  const { id } = await ctx.params;
  if (!(await getContentUrlById(id))) {
    return NextResponse.json({ error: "URL not found" }, { status: 404 });
  }
  return NextResponse.json({ rows: await listMonthlyMetricsForUrl(id) });
}

/**
 * The admin's veto over the anomaly detector, in both directions: exclude a month
 * it did not catch, or hand back one it flagged wrongly. Passing a null override
 * returns the month to whatever the detector decided.
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/urls/[id]/monthly-metrics">) {
  const { id } = await ctx.params;
  const session = await getServerSession(authOptions);
  const body = await req.json().catch(() => ({}));

  const periodStart = body.periodStart;
  if (typeof periodStart !== "string" || !/^\d{4}-\d{2}-01$/.test(periodStart)) {
    return NextResponse.json({ error: "periodStart must be the first of a month (YYYY-MM-01)" }, { status: 400 });
  }
  const override = body.override ?? null;
  if (override !== null && !OVERRIDES.includes(override)) {
    return NextResponse.json({ error: `override must be null, ${OVERRIDES.join(" or ")}` }, { status: 400 });
  }

  if (!(await getContentUrlById(id))) {
    return NextResponse.json({ error: "URL not found" }, { status: 404 });
  }

  await setMonthlyManualOverride(
    id,
    periodStart,
    override,
    typeof body.reason === "string" ? body.reason : null,
    session?.user?.email ?? null,
  );
  return NextResponse.json({ rows: await listMonthlyMetricsForUrl(id) });
}
