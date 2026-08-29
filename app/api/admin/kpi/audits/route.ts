import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { AUDIT_STATUSES, type AuditStatus } from "@/lib/performance/audit-workflow";
import { getContentUrlById } from "@/lib/repositories/content-urls";
import { getAuditRole } from "@/lib/repositories/kpi-audit-roles";
import { getWarningSettings } from "@/lib/repositories/kpi-settings";
import { listAuditQueue, openAudit } from "@/lib/repositories/url-kpi-audits";
import { withTransaction } from "@/lib/db";

/** The audit queue, ordered by the largest KPI drag any one member is carrying. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const session = await getServerSession(authOptions);
  const requested = params.getAll("status").filter((s): s is AuditStatus => AUDIT_STATUSES.includes(s as AuditStatus));

  const rows = await listAuditQueue({
    // Default to the work still to be done, not the whole history.
    status: requested.length ? requested : ["needs_audit", "in_progress"],
    project: params.get("project") || undefined,
    memberName: params.get("member") || undefined,
  });

  return NextResponse.json({
    rows,
    viewer: {
      email: session?.user?.email ?? null,
      role: await getAuditRole(session?.user?.email ?? null),
    },
  });
}

/**
 * Open a case by hand, for a decline someone spotted before the rules did.
 * Returns the existing case if the URL already has one open, rather than
 * creating a second view of the same question.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const body = await req.json().catch(() => ({}));
  const contentUrlId = (body as Record<string, unknown>).contentUrlId;

  if (typeof contentUrlId !== "string" || !contentUrlId) {
    return NextResponse.json({ error: "contentUrlId is required" }, { status: 400 });
  }
  if (!(await getContentUrlById(contentUrlId))) {
    return NextResponse.json({ error: "URL not found" }, { status: 404 });
  }

  const thresholds = await getWarningSettings();
  const result = await withTransaction((client) =>
    openAudit(
      {
        contentUrlId,
        openedBy: session?.user?.email ?? null,
        slaDays: thresholds.auditSlaDays,
        detail: { trigger: "manual", note: typeof (body as Record<string, unknown>).note === "string"
          ? (body as Record<string, unknown>).note
          : undefined },
      },
      client,
    ),
  );

  return NextResponse.json({ audit: result.audit, created: result.created }, { status: result.created ? 201 : 200 });
}
