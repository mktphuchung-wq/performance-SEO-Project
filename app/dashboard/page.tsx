"use client";

import { useEffect, useState } from "react";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { StatCard } from "@/components/StatCard";
import { PerformanceTable, type PerformanceTableRow } from "@/components/PerformanceTable";
import { MetricDeltaInline } from "@/components/MetricDelta";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { RANGE_LABELS, formatCtr, formatNumber, formatScore } from "@/lib/format";
import { DEFAULT_RANGE_KEY, isRollingRange, type RangeKey } from "@/lib/ranges";
import type { MemberRollupRow } from "@/lib/repositories/rollups";
import type { MemberScoreRow } from "@/lib/repositories/kpi-score-rollups";

export default function DashboardPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [rows, setRows] = useState<PerformanceTableRow[]>([]);
  const [rollup, setRollup] = useState<MemberRollupRow | null>(null);
  const [score, setScore] = useState<MemberScoreRow | null>(null);
  const [loading, setLoading] = useState(true);

  const scoreable = isRollingRange(range as RangeKey);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch(`/api/me/urls?range=${range}`).then((r) => r.json()),
      fetch(`/api/me/performance?range=${range}`).then((r) => r.json()),
      fetch(`/api/me/kpi?range=${range}`)
        .then((r) => r.json())
        .catch(() => ({ score: null })),
    ]).then(([urlsRes, perfRes, kpiRes]) => {
      if (cancelled) return;
      setRows(urlsRes.rows ?? []);
      setRollup(perfRes.rollup ?? null);
      setScore(kpiRes.score ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader
        title="My performance"
        description="URLs assigned to you in the content sheet, measured in Search Console."
        action={
          <RangeSwitcher
            value={range}
            onChange={(next) => {
              setLoading(true);
              setRange(next);
            }}
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="KPI score"
          value={scoreable ? formatScore(score?.kpi_score) : "—"}
          sub={
            !scoreable ? (
              `${RANGE_LABELS[range] ?? range} is not scored`
            ) : score ? (
              `${score.normal_url_count} scored · ${score.new_grace_url_count} new · ${score.excluded_url_count} excluded`
            ) : (
              "No eligible URL yet"
            )
          }
        />
        <StatCard
          label="URLs"
          value={rollup ? String(rollup.url_count) : "—"}
          sub={rollup ? `${rollup.urls_with_data} with data` : undefined}
        />
        <StatCard
          label="Clicks"
          value={formatNumber(rollup?.clicks)}
          sub={
            rollup ? (
              <MetricDeltaInline
                delta={rollup.click_delta}
                pct={rollup.click_growth_pct}
                previous={rollup.previous_clicks}
              />
            ) : undefined
          }
        />
        <StatCard
          label="Impressions"
          value={formatNumber(rollup?.impressions)}
          sub={
            rollup ? (
              <MetricDeltaInline
                delta={rollup.impression_delta}
                pct={rollup.impression_growth_pct}
                previous={rollup.previous_impressions}
              />
            ) : undefined
          }
        />
        <StatCard label="CTR" value={formatCtr(rollup?.ctr)} sub={rollup ? "clicks ÷ impressions" : undefined} />
        <StatCard
          label="Growing / Declining"
          value={rollup ? `${rollup.growing_urls} / ${rollup.declining_urls}` : "—"}
          sub={rollup ? `${rollup.no_data_urls} without data` : undefined}
        />
      </div>

      <Card>
        <CardHeader
          title="My URLs"
          description={`${RANGE_LABELS[range] ?? range} — click a URL to see every range side by side.`}
        />
        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-ink-muted">Loading…</p>
        ) : (
          <PerformanceTable rows={rows} />
        )}
      </Card>
    </div>
  );
}
