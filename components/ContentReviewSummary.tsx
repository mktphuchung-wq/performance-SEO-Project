"use client";

import { Card, CardHeader, EmptyState } from "@/components/ui";
import { formatMonthLabel } from "@/lib/content-review/month";
import { formatContentScore, formatPercent } from "@/lib/format";
import type { ContentReviewBatch } from "@/lib/repositories/content-review";
import { TableViewBody, TableViewControls, TableViewport, useTableView } from "@/components/TableView";

/**
 * A member reading their own Content KPI, month by month.
 *
 * Read-only by design: this score is a judgement someone made about the work,
 * and the person being judged should see exactly what was recorded — including
 * the months that have not been graded yet, which show "—" rather than a 0 that
 * would read as a failure.
 *
 * The history is passed in rather than fetched here: the three headline figures
 * above it come from the same response, and two fetches of one endpoint could
 * render a month in the card that the table below does not list.
 *
 * It sits beside the Official KPI card, never merged into it. The two answer
 * different questions (did the traffic grow / was the work good) and averaging
 * them would hide both.
 */
export function ContentReviewSummary({ history, loading }: { history: ContentReviewBatch[]; loading: boolean }) {
  const view = useTableView(
    history,
    [
      { id: "month", label: "Month", value: (row) => row.month, type: "date", groupable: true, groupLabel: (value) => formatMonthLabel(String(value)) },
      { id: "score", label: "Content KPI", value: (row) => row.content_score, type: "number" },
      { id: "quality", label: "Quality", value: (row) => row.avg_quality_pct, type: "number" },
      { id: "tasks", label: "Tasks", value: (row) => row.task_count, type: "number" },
      { id: "completion", label: "Completion", value: (row) => row.completion_pct, type: "number" },
      { id: "status", label: "Status", value: (row) => row.status, groupable: true },
    ],
    { initialSort: { column: "month", direction: "desc" } },
  );

  return (
    <Card>
      <CardHeader
        title="Content KPI — every reviewed month"
        description="Quality of the work itself, graded by hand against your checklist — 0.8 × quality + 0.2 × how much of the monthly target was delivered. Separate from Performance KPI above."
      />

      {loading && <p className="px-5 py-8 text-center text-sm text-ink-muted">Loading…</p>}

      {!loading && history.length === 0 && (
        <EmptyState
          title="No month has been reviewed yet"
          hint="This score appears once an admin has graded a month of your work."
        />
      )}

      {!loading && history.length > 0 && (
        <div>
          <TableViewControls view={view} noun="months" />
          <TableViewport view={view}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-5 py-2.5 font-medium">Month</th>
                <th className="px-4 py-2.5 text-right font-medium">Content KPI</th>
                <th className="px-4 py-2.5 text-right font-medium">Quality</th>
                <th className="px-4 py-2.5 text-right font-medium">Tasks / target</th>
                <th className="px-4 py-2.5 text-right font-medium">Completion</th>
              </tr>
            </thead>
            <TableViewBody
              view={view}
              colSpan={5}
              className="divide-y divide-line"
              renderRow={(batch) => (
                <tr key={batch.id}>
                  <td className="px-5 py-2.5 text-ink">
                    {formatMonthLabel(batch.month)}
                    {batch.status !== "final" && <span className="ml-2 text-[12px] text-ink-subtle">in review</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right numeric text-ink">{formatContentScore(batch.content_score)}</td>
                  <td className="px-4 py-2.5 text-right numeric text-ink-muted">
                    {formatPercent(batch.avg_quality_pct)}
                  </td>
                  <td className="px-4 py-2.5 text-right numeric text-ink-muted">
                    {batch.task_count} / {batch.min_post > 0 ? batch.min_post : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right numeric text-ink-muted">
                    {formatPercent(batch.completion_pct)}
                  </td>
                </tr>
              )}
            />
          </table>
          </TableViewport>
        </div>
      )}
    </Card>
  );
}
