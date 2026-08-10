"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { ProjectComparisonTable } from "@/components/ProjectComparisonTable";
import { KpiScoreTable } from "@/components/KpiScoreTable";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { RANGE_LABELS } from "@/lib/format";
import { DEFAULT_RANGE_KEY, isRollingRange, type RangeKey } from "@/lib/ranges";
import type { ProjectRollupRow } from "@/lib/repositories/rollups";
import type { ProjectScoreRow } from "@/lib/repositories/kpi-score-rollups";

export default function AdminProjectsPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [rows, setRows] = useState<ProjectRollupRow[]>([]);
  const [scores, setScores] = useState<ProjectScoreRow[]>([]);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const scoreable = isRollingRange(range as RangeKey);

  useEffect(() => {
    fetch(`/api/admin/projects?range=${range}`)
      .then((r) => r.json())
      .then((data) => setRows(data.rows ?? []));
  }, [range]);

  useEffect(() => {
    // Ranges without a previous period are never scored, so there is nothing to
    // fetch — the render path shows an explanation instead of an empty table.
    if (!scoreable) return;

    let cancelled = false;
    fetch(`/api/admin/kpi/projects?range=${range}`)
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
        title="Project comparison"
        description="Every project's URLs rolled up. Counts read URLs / URLs with data."
        action={<RangeSwitcher value={range} onChange={setRange} />}
      />

      <Card>
        <CardHeader
          title={`KPI score — ${RANGE_LABELS[range] ?? range}`}
          description="Growth graded 0–100 and weighted by traffic, using each project's own growth expectation."
        />
        {scoreError && <p className="px-5 py-4 text-[13px] text-negative">{scoreError}</p>}
        {!scoreError && !scoreable ? (
          <p className="px-5 py-6 text-center text-[13px] text-ink-muted">
            {RANGE_LABELS[range] ?? range} has no previous period to compare against, so it is not scored.
          </p>
        ) : (
          !scoreError && (
            <KpiScoreTable
              entityLabel="Project"
              rows={scores.map((row) => ({ ...row, key: row.project, label: row.project }))}
            />
          )
        )}
      </Card>

      <Card>
        <CardHeader title={`Traffic — ${RANGE_LABELS[range] ?? range}`} />
        <ProjectComparisonTable rows={rows} />
      </Card>
    </div>
  );
}
