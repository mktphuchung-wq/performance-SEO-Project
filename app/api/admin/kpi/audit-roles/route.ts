import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  AUDIT_ROLES,
  deleteAuditRole,
  listAuditRoles,
  setAuditRole,
  type AuditRole,
} from "@/lib/repositories/kpi-audit-roles";

export async function GET() {
  return NextResponse.json({ roles: await listAuditRoles(), available: AUDIT_ROLES });
}

/**
 * Grant an audit role.
 *
 * Kept out of ADMIN_EMAILS deliberately: reaching the admin pages and being
 * allowed to approve someone else's KPI conclusion are different permissions,
 * and only the second one needs an audit trail of who granted it.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
  }
  const role = body.role;
  if (typeof role !== "string" || !AUDIT_ROLES.includes(role as AuditRole)) {
    return NextResponse.json({ error: `role must be one of ${AUDIT_ROLES.join(", ")}` }, { status: 400 });
  }

  await setAuditRole(
    email,
    role as AuditRole,
    typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
    session?.user?.email ?? null,
  );
  return NextResponse.json({ roles: await listAuditRoles() });
}

export async function DELETE(req: Request) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  await deleteAuditRole(email);
  return NextResponse.json({ roles: await listAuditRoles() });
}
