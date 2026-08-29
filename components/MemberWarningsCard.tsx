"use client";

import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import {
  AUDIT_STATUS_LABELS,
  RANGE_SHORT_LABELS,
  WARNING_LEVEL_LABELS,
  formatDragPoints,
  formatMonth,
  formatPercent,
  formatScore,
} from "@/lib/format";

export interface MemberWarningRow {
  id: string;
  content_url_id: string;
  url: string;
  project: string;
  range_key: string;
  level: string;
  evaluation_month: string;
  kpi_drag_points: number;
  raw_score_snapshot: number | null;
  metric_snapshot: { click_drop_pct?: number | null } | null;
  audit_status: string | null;
  resolved_at: string | null;
}

/**
 * A member's own warnings, read-only.
 *
 * Shown because someone should learn a URL of theirs is being looked at from
 * their own dashboard rather than from a meeting. The wording is deliberate: the
 * number next to a warning is what the URL is already costing them under the
 * current KPI, not a penalty the warning adds.
 */
export function MemberWarningsCard({
  rows,
  loading,
  error,
}: {
  rows: MemberWarningRow[];
  loading: boolean;
  error: string | null;
}) {
  const open = rows.filter((row) => row.resolved_at === null);

  // Nothing to say when there is nothing flagged — an empty card would only add
  // a permanent reminder that warnings exist.
  if (!loading && open.length === 0 && !error) return null;

  return (
    <Card>
      <CardHeader
        title="URLs flagged for review"
        description="These do not change your KPI. The points shown are what each URL already costs it today."
      />
      {loading ? (
        <p className="px-5 py-8 text-center text-sm text-ink-muted">Loading…</p>
      ) : error ? (
        <p className="px-5 py-4 text-[13px] text-negative">{error}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line bg-neutral-soft/60 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                <th className="px-5 py-2.5 text-left">URL</th>
                <th className="px-5 py-2.5 text-left">Range</th>
                <th className="px-5 py-2.5 text-left">Month</th>
                <th className="px-5 py-2.5 text-left">Level</th>
                <th className="px-5 py-2.5 text-right">Score</th>
                <th className="px-5 py-2.5 text-right">Click drop</th>
                <th className="px-5 py-2.5 text-right">KPI cost</th>
                <th className="px-5 py-2.5 text-left">Audit</th>
              </tr>
            </thead>
            <tbody>
              {open.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0 hover:bg-neutral-soft/50">
                  <td className="max-w-[280px] px-5 py-2.5">
                    <Link
                      href={`/dashboard/url/${row.content_url_id}`}
                      className="block truncate text-accent hover:underline"
                    >
                      {row.url}
                    </Link>
                    <span className="text-[13px] text-ink-subtle">{row.project}</span>
                  </td>
                  <td className="px-5 py-2.5">{RANGE_SHORT_LABELS[row.range_key] ?? row.range_key}</td>
                  <td className="px-5 py-2.5">{formatMonth(row.evaluation_month)}</td>
                  <td className="px-5 py-2.5">
                    <Badge tone={row.level === "mandatory_audit" ? "negative" : "warning"}>
                      {WARNING_LEVEL_LABELS[row.level] ?? row.level}
                    </Badge>
                  </td>
                  <td className="numeric px-5 py-2.5 text-right">{formatScore(row.raw_score_snapshot)}</td>
                  <td className="numeric px-5 py-2.5 text-right">
                    {formatPercent(row.metric_snapshot?.click_drop_pct ?? null)}
                  </td>
                  <td className="numeric px-5 py-2.5 text-right font-medium">
                    {formatDragPoints(row.kpi_drag_points)}
                  </td>
                  <td className="px-5 py-2.5 text-[13px] text-ink-muted">
                    {row.audit_status ? (AUDIT_STATUS_LABELS[row.audit_status] ?? row.audit_status) : "Monitoring"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
