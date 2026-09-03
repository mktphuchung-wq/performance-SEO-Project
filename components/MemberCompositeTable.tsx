"use client";

import { TableViewBody, TableViewControls, TableViewport, useTableView } from "@/components/TableView";
import { TrendBadge } from "@/components/TrendBadge";
import { Badge, EmptyState, type BadgeTone } from "@/components/ui";
import { KPI_STRATEGY_LABELS, formatOfficialKpi, formatScore } from "@/lib/format";
import { formatWeightMix, type MemberCompositeKpi } from "@/lib/performance/composite-score";

function scoreTone(value: number | null): BadgeTone {
  if (value === null) return "neutral";
  if (value >= 80) return "positive";
  if (value >= 50) return "accent";
  return "negative";
}

/** Official KPI per member with the periods it was built from beside it. */
export function MemberCompositeTable({ rows }: { rows: MemberCompositeKpi[] }) {
  const view = useTableView(
    rows,
    [
      { id: "name", label: "Member", value: (row) => row.memberName },
      { id: "official", label: "Official KPI", value: (row) => row.officialKpi, type: "number" },
      { id: "score1m", label: "1M", value: (row) => row.score1m, type: "number" },
      { id: "score3m", label: "3M", value: (row) => row.score3m, type: "number" },
      { id: "score6m", label: "6M", value: (row) => row.score6m, type: "number" },
      { id: "trend", label: "Trend", value: (row) => row.trend, groupable: true },
      {
        id: "strategy",
        label: "Strategy",
        value: (row) => KPI_STRATEGY_LABELS[row.strategy] ?? row.strategy,
        groupable: true,
      },
      {
        id: "periods",
        label: "Available periods",
        value: (row) => row.availablePeriodCount,
        type: "number",
        groupable: true,
      },
    ],
    { initialSort: { column: "official", direction: "desc" } },
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No member has a scored period yet."
        hint="Official KPI is derived from the 1M / 3M / 6M scores — refresh a rolling range, or run Recompute scores in Admin → Overview."
      />
    );
  }

  return (
    <div>
      <TableViewControls view={view} noun="members" />
      <TableViewport view={view}>
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium uppercase tracking-wide text-ink-subtle">
              <th className="px-4 py-2.5 text-left">Member</th>
              <th
                className="px-4 py-2.5 text-right"
                title="25% 1M · 50% 3M · 25% 6M, unless a personal strategy is set"
              >
                Official KPI
              </th>
              <th className="px-4 py-2.5 text-right">1M</th>
              <th className="px-4 py-2.5 text-right">3M</th>
              <th className="px-4 py-2.5 text-right">6M</th>
              <th className="px-4 py-2.5 text-left">Trend</th>
              <th className="px-4 py-2.5 text-left">Strategy</th>
            </tr>
          </thead>
          <TableViewBody
            view={view}
            colSpan={7}
            renderRow={(row) => (
              <tr key={row.memberName} className="border-b border-line last:border-0 hover:bg-neutral-soft/50">
                <td className="px-4 py-2.5 font-medium text-ink">{row.memberName}</td>
                <td className="px-4 py-2.5 text-right">
                  {row.officialKpi === null ? (
                    <span className="text-ink-subtle" title="No scored period — not a score of zero">—</span>
                  ) : (
                    <Badge tone={scoreTone(row.officialKpi)}>{formatOfficialKpi(row.officialKpi)}</Badge>
                  )}
                </td>
                <td className="numeric px-4 py-2.5 text-right text-ink">{formatScore(row.score1m)}</td>
                <td className="numeric px-4 py-2.5 text-right font-medium text-ink">{formatScore(row.score3m)}</td>
                <td className="numeric px-4 py-2.5 text-right text-ink">{formatScore(row.score6m)}</td>
                <td className="px-4 py-2.5"><TrendBadge trend={row.trend} size="sm" /></td>
                <td className="px-4 py-2.5 text-[13px] text-ink-muted" title={formatWeightMix(row.weights)}>
                  {KPI_STRATEGY_LABELS[row.strategy] ?? row.strategy}
                  {row.availablePeriodCount < 3 && (
                    <span className="ml-1.5 text-ink-subtle">· {row.availablePeriodCount}/3 periods</span>
                  )}
                </td>
              </tr>
            )}
          />
        </table>
      </TableViewport>
    </div>
  );
}
