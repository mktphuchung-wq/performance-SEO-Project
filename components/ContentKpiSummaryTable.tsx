"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { formatMonthLabel } from "@/lib/content-review/month";
import { formatContentScore, formatPercent } from "@/lib/format";
import type { ContentKpiSummaryRow } from "@/lib/repositories/content-review";
import { TableViewBody, TableViewControls, TableViewport, useTableView } from "@/components/TableView";

interface SummaryResponse {
  rows: ContentKpiSummaryRow[];
  thisMonth: string | null;
  previousMonth: string | null;
}

const ROLLING_MONTHS = 3;

/**
 * Content KPI for every member — this calendar month, last calendar month, and
 * the rolling three-month average.
 *
 * It is a card of its own, sitting beside the Official KPI table rather than
 * inside it. The two are different measurements over different windows: Official
 * KPI blends rolling 1M/3M/6M Search Console scores, this one is a human's
 * verdict on one calendar month. Sharing a row would invite reading across them
 * as if a column meant the same thing on both sides.
 *
 * For the same reason it ignores the RangeSwitcher on the pages that host it —
 * "this month" is a month, not a range, and there is nothing for 1M/3M/6M to
 * change about it.
 */
export function ContentKpiSummaryTable({ title = "Content KPI" }: { title?: string }) {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/content-review/summary")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not load Content KPI");
        return body as SummaryResponse;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setData({ rows: [], thisMonth: null, previousMonth: null });
        setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const loading = data === null && error === null;
  const rows = data?.rows ?? [];
  const view = useTableView(
    rows,
    [
      { id: "member", label: "Member", value: (row) => row.memberName, groupable: true },
      { id: "this_month", label: "This month", value: (row) => row.thisMonth?.content_score, type: "number" },
      { id: "previous_month", label: "Previous month", value: (row) => row.previousMonth?.content_score, type: "number" },
      { id: "three_month", label: "3-month average", value: (row) => row.threeMonthAvg, type: "number" },
      { id: "scored_months", label: "Scored months", value: (row) => row.scoredMonthCount, type: "number" },
    ],
    { initialSort: { column: "three_month", direction: "desc" } },
  );

  const window =
    data?.thisMonth && data?.previousMonth
      ? `${formatMonthLabel(data.previousMonth)} → ${formatMonthLabel(data.thisMonth)}`
      : "";

  return (
    <Card>
      <CardHeader
        title={title}
        description={`Graded by hand against each member's own checklist — 0.8 × quality + 0.2 × delivery against the monthly target. Calendar months${window ? ` (${window})` : ""}, so the range switcher does not apply. A month still being reviewed reads “—”, never 0.`}
      />

      {error && <p className="px-5 py-4 text-[13px] text-negative">{error}</p>}
      {loading && <p className="px-5 py-10 text-center text-sm text-ink-muted">Loading…</p>}

      {!loading && !error && rows.length === 0 && (
        <EmptyState title="No members to show" hint="Members appear here once they own a URL or have an alias." />
      )}

      {!loading && !error && rows.length > 0 && (
        <div>
          <TableViewControls view={view} noun="members" />
          <TableViewport view={view}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-5 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 text-right font-medium">
                  This month{data?.thisMonth ? ` · ${formatMonthLabel(data.thisMonth)}` : ""}
                </th>
                <th className="px-4 py-2.5 text-right font-medium">
                  Previous month{data?.previousMonth ? ` · ${formatMonthLabel(data.previousMonth)}` : ""}
                </th>
                <th className="px-4 py-2.5 text-right font-medium">3-month avg</th>
              </tr>
            </thead>
            <TableViewBody
              view={view}
              colSpan={4}
              className="divide-y divide-line"
              renderRow={(row) => {
                const missing = ROLLING_MONTHS - row.scoredMonthCount;
                return (
                  <tr key={row.memberName}>
                    <td className="px-5 py-2.5 text-ink">{row.memberName}</td>

                    <td className="px-4 py-2.5 text-right">
                      <div className="numeric text-ink">{formatContentScore(row.thisMonth?.content_score)}</div>
                      <div className="text-[12px] text-ink-subtle">
                        {row.thisMonth
                          ? `${formatPercent(row.thisMonth.avg_quality_pct)} quality · ${row.thisMonth.task_count}/${
                              row.thisMonth.min_post > 0 ? row.thisMonth.min_post : "—"
                            } tasks`
                          : "Not reviewed"}
                      </div>
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      <div className="numeric text-ink-muted">
                        {formatContentScore(row.previousMonth?.content_score)}
                      </div>
                      <div className="text-[12px] text-ink-subtle">
                        {row.previousMonth
                          ? `${formatPercent(row.previousMonth.avg_quality_pct)} quality · ${
                              row.previousMonth.task_count
                            }/${row.previousMonth.min_post > 0 ? row.previousMonth.min_post : "—"} tasks`
                          : "Not reviewed"}
                      </div>
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      <div className="numeric text-ink">{formatContentScore(row.threeMonthAvg)}</div>
                      {/* Below three scored months the average is withheld rather
                          than taken over fewer — two months averaged against a
                          colleague's three is not a comparison. */}
                      <div className="text-[12px] text-ink-subtle">
                        {row.threeMonthAvg !== null
                          ? row.threeMonthMonths.map(formatMonthLabel).join(" · ")
                          : `${missing} more month${missing === 1 ? "" : "s"} needed`}
                      </div>
                    </td>
                  </tr>
                );
              }}
            />
          </table>
          </TableViewport>
        </div>
      )}
    </Card>
  );
}
