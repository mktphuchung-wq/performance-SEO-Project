"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { MemberComparisonTable } from "@/components/MemberComparisonTable";
import { ContentKpiSummaryTable } from "@/components/ContentKpiSummaryTable";
import { KpiScoreTable } from "@/components/KpiScoreTable";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { RANGE_LABELS } from "@/lib/format";
import { DEFAULT_RANGE_KEY, isRollingRange, type RangeKey } from "@/lib/ranges";
import type { MemberRollupRow } from "@/lib/repositories/rollups";
import type { MemberScoreRow } from "@/lib/repositories/kpi-score-rollups";

export default function AdminMembersPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [rows, setRows] = useState<MemberRollupRow[]>([]);
  const [scores, setScores] = useState<MemberScoreRow[]>([]);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const scoreable = isRollingRange(range as RangeKey);

  useEffect(() => {
    fetch(`/api/admin/members?range=${range}`)
      .then((r) => r.json())
      .then((data) => setRows(data.rows ?? []));
  }, [range]);

  useEffect(() => {
    // Ranges without a previous period are never scored, so there is nothing to
    // fetch — the render path shows an explanation instead of an empty table.
    if (!scoreable) return;

    let cancelled = false;
    fetch(`/api/admin/kpi/members?range=${range}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load KPI scores");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setScores(data.rows ?? []);
        setScoreError(null);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setScores([]);
        setScoreError(error.message);
      });

    return () => {
      cancelled = true;
    };
  }, [range, scoreable]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader
        title="Member comparison"
        description="Every member's URLs rolled up. Counts read URLs / URLs with data."
        action={<RangeSwitcher value={range} onChange={setRange} />}
      />

      {/* The manually reviewed KPI, as its own card above the Search Console one.
          It follows the calendar, not the range switcher in the header — see the
          component for why the two are not merged into one table. */}
      <ContentKpiSummaryTable />

      <Card>
        <CardHeader
          title={`KPI score — ${RANGE_LABELS[range] ?? range}`}
          description="Growth graded 0–100 and weighted by traffic. See Admin → KPI for the same scores next to volume and raw deltas."
        />
        {scoreError && <p className="px-5 py-4 text-[13px] text-negative">{scoreError}</p>}
        {!scoreError && !scoreable ? (
          <p className="px-5 py-6 text-center text-[13px] text-ink-muted">
            {RANGE_LABELS[range] ?? range} has no previous period to compare against, so it is not scored.
          </p>
        ) : (
          !scoreError && (
            <KpiScoreTable
              entityLabel="Member"
              showDirectionAdjustment
              rows={scores.map((row) => ({ ...row, key: row.member_name, label: row.member_name }))}
            />
          )
        )}
      </Card>

      <Card>
        <CardHeader title={`Traffic — ${RANGE_LABELS[range] ?? range}`} />
        <MemberComparisonTable rows={rows} />
      </Card>
    </div>
  );
}
