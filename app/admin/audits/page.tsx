"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuditDetailPanel } from "@/components/AuditDetailPanel";
import { StatCard } from "@/components/StatCard";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import {
  AUDIT_STATUS_LABELS,
  RANGE_SHORT_LABELS,
  WARNING_LEVEL_LABELS,
  WARNING_RESOLUTION_LABELS,
  formatDragPoints,
  formatMonth,
  formatPercent,
  formatScore,
  formatSlaRemaining,
} from "@/lib/format";
import { slaBreached } from "@/lib/performance/audit-workflow";

interface WarningRow {
  id: string;
  content_url_id: string;
  url: string;
  project: string;
  member_name: string;
  range_key: string;
  level: string;
  evaluation_month: string;
  kpi_drag_points: number;
  raw_score_snapshot: number | null;
  consecutive_count: number;
  metric_snapshot: { click_drop_pct?: number | null; click_loss?: number | null } | null;
  audit_id: string | null;
  audit_status: string | null;
  resolution: string | null;
  resolved_at: string | null;
}

interface AuditRow {
  id: string;
  url: string;
  project: string;
  status: string;
  conclusion: string | null;
  affected_members: string | null;
  max_kpi_drag_points: number | null;
  warning_count: number;
  sla_deadline: string;
  resolved_at: string | null;
}

type Tab = "warnings" | "audits";

export default function AuditsPage() {
  const [tab, setTab] = useState<Tab>("warnings");
  const [warnings, setWarnings] = useState<WarningRow[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluationNote, setEvaluationNote] = useState<{ text: string; failed: boolean } | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const reload = useCallback(() => setDataVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const query = month ? `?month=${month}` : "";
    Promise.all([
      fetch(`/api/admin/kpi/warnings${query}`).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not load warnings");
        return body;
      }),
      fetch("/api/admin/kpi/audits").then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not load audits");
        return body;
      }),
    ])
      .then(([warningBody, auditBody]) => {
        if (cancelled) return;
        setWarnings(warningBody.rows ?? []);
        setMonths(warningBody.months ?? []);
        setAudits(auditBody.rows ?? []);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setWarnings([]);
        setAudits([]);
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, dataVersion]);

  async function evaluate() {
    setEvaluating(true);
    setEvaluationNote(null);
    try {
      const res = await fetch("/api/admin/kpi/evaluate-warnings", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Evaluation failed");
      setEvaluationNote({
        text:
          `${formatMonth(body.evaluationMonth)}: ${body.warningsWritten} warning(s) — `
          + `${body.earlyWarnings} early, ${body.mandatoryAudits} mandatory. `
          + `${body.auditsOpened} case(s) opened, ${body.recoveredWarnings} recovered.`,
        failed: false,
      });
      reload();
    } catch (err) {
      setEvaluationNote({ text: (err as Error).message, failed: true });
    } finally {
      setEvaluating(false);
    }
  }

  const openAudits = audits.filter((a) => a.status === "needs_audit" || a.status === "in_progress");
  const overdue = openAudits.filter((a) => slaBreached(a.sla_deadline, a.resolved_at));
  const totalDrag = warnings.reduce((sum, w) => sum + Number(w.kpi_drag_points ?? 0), 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader
        title="Warnings & audits"
        description="URLs worth investigating, ranked by the KPI points they cost. Nothing here changes a score."
        action={
          <Button onClick={evaluate} disabled={evaluating}>
            {evaluating ? "Evaluating…" : "Evaluate warnings"}
          </Button>
        }
      />

      {evaluationNote && (
        <p className={`text-[13px] ${evaluationNote.failed ? "text-negative" : "text-ink-muted"}`}>
          {evaluationNote.text}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open warnings" value={String(warnings.length)} sub="Ranked by KPI drag" />
        <StatCard label="KPI points at stake" value={formatDragPoints(totalDrag)} sub="Summed across members" />
        <StatCard label="Open audits" value={String(openAudits.length)} sub={`${audits.length} in view`} />
        <StatCard label="Past SLA" value={String(overdue.length)} sub="Measures the queue, not a score" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {(["warnings", "audits"] as Tab[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === key ? "bg-accent-soft text-accent-hover" : "text-ink-muted hover:bg-neutral-soft hover:text-ink"
              }`}
            >
              {key === "warnings" ? "Warnings" : "Audits"}
            </button>
          ))}
        </div>
        {tab === "warnings" && months.length > 0 && (
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
          >
            <option value="">All months</option>
            {months.map((value) => (
              <option key={value} value={value}>
                {formatMonth(value)}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="text-[13px] text-negative">{error}</p>}

      {tab === "warnings" ? (
        <Card>
          <CardHeader
            title="Warning queue"
            description="A warning is a request to look at a URL. It never changes the KPI it reports on."
          />
          {loading ? (
            <p className="px-5 py-10 text-center text-sm text-ink-muted">Loading…</p>
          ) : warnings.length === 0 ? (
            <EmptyState title="No open warnings" hint="Run an evaluation after a refresh, or widen the month filter." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-neutral-soft/60 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    <th className="px-4 py-2.5 text-left">URL</th>
                    <th className="px-4 py-2.5 text-left">Member</th>
                    <th className="px-4 py-2.5 text-left">Range</th>
                    <th className="px-4 py-2.5 text-left">Month</th>
                    <th className="px-4 py-2.5 text-left">Level</th>
                    <th className="px-4 py-2.5 text-right">Score</th>
                    <th className="px-4 py-2.5 text-right">Click drop</th>
                    <th className="px-4 py-2.5 text-right">KPI drag</th>
                    <th className="px-4 py-2.5 text-left">Audit</th>
                  </tr>
                </thead>
                <tbody>
                  {warnings.map((row) => (
                    <tr key={row.id} className="border-b border-line last:border-0 hover:bg-neutral-soft/50">
                      <td className="max-w-[280px] px-4 py-2.5">
                        <Link
                          href={`/dashboard/url/${row.content_url_id}`}
                          className="block truncate text-accent hover:underline"
                        >
                          {row.url}
                        </Link>
                        <span className="text-[13px] text-ink-subtle">{row.project}</span>
                      </td>
                      <td className="px-4 py-2.5">{row.member_name}</td>
                      <td className="px-4 py-2.5">{RANGE_SHORT_LABELS[row.range_key] ?? row.range_key}</td>
                      <td className="px-4 py-2.5">
                        {formatMonth(row.evaluation_month)}
                        {row.consecutive_count > 1 && (
                          <span className="ml-1.5 text-[13px] text-ink-subtle">&times;{row.consecutive_count}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={row.level === "mandatory_audit" ? "negative" : "warning"}>
                          {WARNING_LEVEL_LABELS[row.level] ?? row.level}
                        </Badge>
                      </td>
                      <td className="numeric px-4 py-2.5 text-right">{formatScore(row.raw_score_snapshot)}</td>
                      <td className="numeric px-4 py-2.5 text-right">
                        {formatPercent(row.metric_snapshot?.click_drop_pct ?? null)}
                      </td>
                      <td className="numeric px-4 py-2.5 text-right font-medium">
                        {formatDragPoints(row.kpi_drag_points)}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.audit_id ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelected(row.audit_id);
                              setTab("audits");
                            }}
                            className="text-accent hover:underline"
                          >
                            {AUDIT_STATUS_LABELS[row.audit_status ?? ""] ?? "Open case"}
                          </button>
                        ) : row.resolution ? (
                          <span className="text-[13px] text-ink-subtle">
                            {WARNING_RESOLUTION_LABELS[row.resolution] ?? row.resolution}
                          </span>
                        ) : (
                          <span className="text-[13px] text-ink-subtle">Monitoring</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Audit queue"
              description="Ordered by the largest KPI drag any one member carries, not by how many URLs there are."
            />
            {loading ? (
              <p className="px-5 py-10 text-center text-sm text-ink-muted">Loading…</p>
            ) : audits.length === 0 ? (
              <EmptyState title="No open audits" hint="Mandatory-audit warnings open a case automatically." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-line bg-neutral-soft/60 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                      <th className="px-4 py-2.5 text-left">URL</th>
                      <th className="px-4 py-2.5 text-left">Members</th>
                      <th className="px-4 py-2.5 text-left">Status</th>
                      <th className="px-4 py-2.5 text-right">Worst drag</th>
                      <th className="px-4 py-2.5 text-left">SLA</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {audits.map((row) => {
                      const late = slaBreached(row.sla_deadline, row.resolved_at);
                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-line last:border-0 hover:bg-neutral-soft/50 ${
                            selected === row.id ? "bg-accent-soft/40" : ""
                          }`}
                        >
                          <td className="max-w-[300px] px-4 py-2.5">
                            <span className="block truncate text-ink">{row.url}</span>
                            <span className="text-[13px] text-ink-subtle">{row.project}</span>
                          </td>
                          <td className="px-4 py-2.5">{row.affected_members ?? "—"}</td>
                          <td className="px-4 py-2.5">
                            <Badge
                              tone={
                                row.status === "resolved"
                                  ? "positive"
                                  : row.status === "cancelled"
                                    ? "neutral"
                                    : "warning"
                              }
                            >
                              {AUDIT_STATUS_LABELS[row.status] ?? row.status}
                            </Badge>
                          </td>
                          <td className="numeric px-4 py-2.5 text-right font-medium">
                            {formatDragPoints(row.max_kpi_drag_points)}
                          </td>
                          <td className={`px-4 py-2.5 text-[13px] ${late ? "text-negative" : "text-ink-muted"}`}>
                            {formatSlaRemaining(row.sla_deadline, row.resolved_at)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => setSelected(selected === row.id ? null : row.id)}
                              className="text-accent hover:underline"
                            >
                              {selected === row.id ? "Close" : "Open"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {selected && <AuditDetailPanel auditId={selected} onChanged={reload} />}
        </div>
      )}
    </div>
  );
}
