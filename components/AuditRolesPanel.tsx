"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, inputClass } from "@/components/ui";
import { AUDIT_ROLE_LABELS, formatDate } from "@/lib/format";
import { TableViewBody, TableViewControls, TableViewport, useTableView } from "@/components/TableView";

interface AuditRoleRow {
  email: string;
  role: string;
  note: string | null;
  granted_by: string | null;
  updated_at: string;
}

const ROLE_HINTS: Record<string, string> = {
  auditor: "Investigate and propose a conclusion.",
  approver: "Sign off on someone else's conclusion.",
  lead: "Approve, plus cases over the escalation threshold.",
};

/**
 * Who may audit and who may sign off.
 *
 * Separate from ADMIN_EMAILS because they are separate permissions: reaching the
 * admin pages is not the same as being allowed to approve someone else's KPI
 * conclusion. An admin with no row here can still open and investigate a case —
 * only approving has to be granted, and the grant is attributed.
 */
export function AuditRolesPanel() {
  const [rows, setRows] = useState<AuditRoleRow[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("approver");
  const [note, setNote] = useState("");
  const view = useTableView(
    rows,
    [
      { id: "email", label: "Email", value: (row) => row.email },
      { id: "role", label: "Role", value: (row) => AUDIT_ROLE_LABELS[row.role] ?? row.role, groupable: true },
      { id: "note", label: "Note", value: (row) => row.note },
      { id: "granted_by", label: "Granted by", value: (row) => row.granted_by, groupable: true },
      { id: "updated", label: "Granted", value: (row) => row.updated_at, type: "date" },
    ],
    { initialSort: { column: "email", direction: "asc" } },
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/kpi/audit-roles");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load audit roles");
      setRows(body.roles ?? []);
      setAvailable(body.available ?? []);
      setMessage(null);
    } catch (err) {
      setMessage({ text: (err as Error).message, failed: true });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/kpi/audit-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, note }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save that role");
      setRows(body.roles ?? []);
      setEmail("");
      setNote("");
      setMessage({ text: "Role saved.", failed: false });
    } catch (err) {
      setMessage({ text: (err as Error).message, failed: true });
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: string) {
    if (!window.confirm(`Remove the audit role for ${target}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/kpi/audit-roles?email=${encodeURIComponent(target)}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not remove that role");
      setRows(body.roles ?? []);
      setMessage({ text: `Removed ${target}.`, failed: false });
    } catch (err) {
      setMessage({ text: (err as Error).message, failed: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Audit roles"
        description="Approving needs at least two people with the approver or lead role — nobody can sign off on their own conclusion."
      />
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-4">
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.com"
            className={inputClass}
          />
        </Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
            {(available.length ? available : ["auditor", "approver", "lead"]).map((value) => (
              <option key={value} value={value}>
                {AUDIT_ROLE_LABELS[value] ?? value}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink-subtle">{ROLE_HINTS[role]}</span>
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </Field>
        <Button onClick={submit} disabled={busy || !email.trim()}>
          {busy ? "Saving…" : "Grant role"}
        </Button>
      </div>
      {loading ? (
        <p className="px-5 py-8 text-center text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nobody can approve an audit yet"
          hint="Grant the approver role to at least two people, or every proposed conclusion will sit unapproved."
        />
      ) : (
        <div>
          <TableViewControls view={view} noun="roles" />
          <TableViewport view={view}>
          <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-neutral-soft/60 text-xs font-medium uppercase tracking-wide text-ink-subtle">
              <th className="px-5 py-2.5 text-left">Email</th>
              <th className="px-5 py-2.5 text-left">Role</th>
              <th className="px-5 py-2.5 text-left">Note</th>
              <th className="px-5 py-2.5 text-left">Granted</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <TableViewBody
            view={view}
            colSpan={5}
            renderRow={(row) => (
              <tr key={row.email} className="border-b border-line last:border-0">
                <td className="px-5 py-2.5 text-ink">{row.email}</td>
                <td className="px-5 py-2.5">
                  <Badge tone={row.role === "lead" ? "accent" : row.role === "approver" ? "positive" : "neutral"}>
                    {AUDIT_ROLE_LABELS[row.role] ?? row.role}
                  </Badge>
                </td>
                <td className="px-5 py-2.5 text-[13px] text-ink-muted">{row.note ?? "—"}</td>
                <td className="px-5 py-2.5 text-[13px] text-ink-muted">
                  {row.granted_by ?? "—"} · {formatDate(row.updated_at)}
                </td>
                <td className="px-5 py-2.5 text-right">
                  <Button variant="danger" disabled={busy} onClick={() => remove(row.email)}>
                    Remove
                  </Button>
                </td>
              </tr>
            )}
          />
        </table>
          </TableViewport>
        </div>
      )}
      {message && (
        <p className={`border-t border-line px-5 py-3 text-[13px] ${message.failed ? "text-negative" : "text-ink-muted"}`}>
          {message.text}
        </p>
      )}
    </Card>
  );
}
