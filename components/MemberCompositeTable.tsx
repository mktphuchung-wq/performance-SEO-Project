"use client";

import { useMemo, useState } from "react";
import { TrendBadge } from "@/components/TrendBadge";
import { Badge, EmptyState, inputClass, type BadgeTone } from "@/components/ui";
import { KPI_STRATEGY_LABELS, formatOfficialKpi, formatScore } from "@/lib/format";
import { formatWeightMix, type MemberCompositeKpi } from "@/lib/performance/composite-score";

type SortKey = "name" | "official" | "score1m" | "score3m" | "score6m";

function scoreTone(value: number | null): BadgeTone {
  if (value === null) return "neutral";
  if (value >= 80) return "positive";
  if (value >= 50) return "accent";
  return "negative";
}

function valueFor(row: MemberCompositeKpi, key: SortKey): string | number | null {
  switch (key) {
    case "name":
      return row.memberName.toLowerCase();
    case "official":
      return row.officialKpi;
    default:
      return row[key];
  }
}

/**
 * Official KPI per member with the periods it was built from beside it.
 *
 * Ranking is by Official KPI alone. Trend is shown but never sorts: a member who
 * is improving from 55 has not out-performed one holding 82, and letting the
 * direction reorder the table would quietly turn a diagnostic into a grade.
 */
export function MemberCompositeTable({ rows }: { rows: MemberCompositeKpi[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("official");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? rows.filter((row) => row.memberName.toLowerCase().includes(needle)) : rows;
  }, [rows, search]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = valueFor(a, sortKey);
      const bv = valueFor(b, sortKey);
      // A member without a score is not a low scorer — never ranked, always last.
      if (av === null && bv === null) return a.memberName.localeCompare(b.memberName);
      if (av === null) return 1;
      if (bv === null) return -1;
      return av < bv ? -dir : av > bv ? dir : a.memberName.localeCompare(b.memberName);
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No member has a scored period yet."
        hint="Official KPI is derived from the 1M / 3M / 6M scores — refresh a rolling range, or run Recompute scores in Admin → Overview."
      />
    );
  }

  const header = (key: SortKey, label: string, align: "left" | "right" = "right", title?: string) => (
    <th
      aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-4 py-2.5 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => toggleSort(key)}
        title={title}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-ink ${
          sortKey === key ? "text-ink" : ""
        }`}
      >
        {label}
        <span aria-hidden="true" className={sortKey === key ? "" : "opacity-0"}>
          {sortDir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by member…"
          aria-label="Filter by member"
          className={`${inputClass} max-w-xs`}
        />
        <span className="text-[13px] text-ink-subtle">
          {sorted.length} of {rows.length} member{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line bg-neutral-soft/60 text-left text-xs font-medium text-ink-subtle">
              {header("name", "Member", "left")}
              {header("official", "Official KPI", "right", "25% 1M · 50% 3M · 25% 6M, unless a personal strategy is set")}
              {header("score1m", "1M")}
              {header("score3m", "3M")}
              {header("score6m", "6M")}
              <th className="px-4 py-2.5 text-left uppercase tracking-wide">Trend</th>
              <th className="px-4 py-2.5 text-left uppercase tracking-wide">Strategy</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.memberName} className="border-b border-line last:border-0 hover:bg-neutral-soft/50">
                <td className="px-4 py-2.5 font-medium text-ink">{row.memberName}</td>
                <td className="px-4 py-2.5 text-right">
                  {row.officialKpi === null ? (
                    <span className="text-ink-subtle" title="No scored period — not a score of zero">
                      —
                    </span>
                  ) : (
                    <Badge tone={scoreTone(row.officialKpi)}>{formatOfficialKpi(row.officialKpi)}</Badge>
                  )}
                </td>
                <td className="numeric px-4 py-2.5 text-right text-ink">{formatScore(row.score1m)}</td>
                <td className="numeric px-4 py-2.5 text-right font-medium text-ink">{formatScore(row.score3m)}</td>
                <td className="numeric px-4 py-2.5 text-right text-ink">{formatScore(row.score6m)}</td>
                <td className="px-4 py-2.5">
                  <TrendBadge trend={row.trend} size="sm" />
                </td>
                <td className="px-4 py-2.5 text-[13px] text-ink-muted" title={formatWeightMix(row.weights)}>
                  {KPI_STRATEGY_LABELS[row.strategy] ?? row.strategy}
                  {row.availablePeriodCount < 3 && (
                    <span className="ml-1.5 text-ink-subtle">· {row.availablePeriodCount}/3 periods</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
