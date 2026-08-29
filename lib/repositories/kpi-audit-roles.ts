import { query, queryOne, type DbExecutor } from "@/lib/db";

export type AuditRole = "auditor" | "approver" | "lead";

export const AUDIT_ROLES: AuditRole[] = ["auditor", "approver", "lead"];

export interface KpiAuditRoleRow {
  email: string;
  role: AuditRole;
  note: string | null;
  granted_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The two roles that may sign off on someone else's conclusion. `auditor` is
 * everything else: open a case, gather evidence, propose an answer.
 */
export function canApprove(role: AuditRole | null): boolean {
  return role === "approver" || role === "lead";
}

/** Only a lead may clear a case whose adjustment exposure is over the policy threshold. */
export function canEscalate(role: AuditRole | null): boolean {
  return role === "lead";
}

/**
 * An admin with no row here is an auditor: they can investigate, they cannot
 * approve. Read as null rather than defaulting to "approver" on purpose — the
 * failure mode of a missing role should be too little authority, not too much.
 */
export async function getAuditRole(email: string | null, db?: DbExecutor): Promise<AuditRole | null> {
  if (!email) return null;
  const sql = "select role from public.kpi_audit_roles where lower(email) = lower($1)";
  const row = db
    ? (await db.query<{ role: AuditRole }>(sql, [email])).rows[0] ?? null
    : await queryOne<{ role: AuditRole }>(sql, [email]);
  return row?.role ?? null;
}

export async function listAuditRoles(): Promise<KpiAuditRoleRow[]> {
  return query<KpiAuditRoleRow>("select * from public.kpi_audit_roles order by role, email");
}

export async function setAuditRole(
  email: string,
  role: AuditRole,
  note: string | null,
  grantedBy: string | null,
): Promise<void> {
  await query(
    `insert into public.kpi_audit_roles (email, role, note, granted_by, updated_at)
     values (lower($1), $2, $3, $4, now())
     on conflict (email) do update set
       role = excluded.role,
       note = excluded.note,
       granted_by = excluded.granted_by,
       updated_at = now()`,
    [email, role, note, grantedBy],
  );
}

export async function deleteAuditRole(email: string): Promise<void> {
  await query("delete from public.kpi_audit_roles where lower(email) = lower($1)", [email]);
}
