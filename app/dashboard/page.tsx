"use client";

import { useEffect, useState } from "react";
import { ContentReviewSummary } from "@/components/ContentReviewSummary";
import { MemberKpiSummary } from "@/components/MemberKpiSummary";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { StatCard } from "@/components/StatCard";
import { PerformanceTable, type PerformanceTableRow } from "@/components/PerformanceTable";
import { MetricDeltaInline } from "@/components/MetricDelta";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { RANGE_LABELS, formatCtr, formatNumber, formatScore } from "@/lib/format";
import type { MemberCompositeKpi } from "@/lib/performance/composite-score";
import { DEFAULT_RANGE_KEY, isRollingRange, type RangeKey } from "@/lib/ranges";
import type { MemberRollupRow } from "@/lib/repositories/rollups";
import type { MemberScoreRow } from "@/lib/repositories/kpi-score-rollups";

export default function DashboardPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [rows, setRows] = useState<PerformanceTableRow[]>([]);
  const [rollup, setRollup] = useState<MemberRollupRow | null>(null);
  const [score, setScore] = useState<MemberScoreRow | null>(null);
  const [summary, setSummary] = useState<MemberCompositeKpi | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  const scoreable = isRollingRange(range as RangeKey);

  // Official KPI is derived from 1M + 3M + 6M together, so it is fetched once
  // and never refetched when the range changes — the RangeSwitcher investigates
  // the data behind the score, it does not redefine the score.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/me/kpi-summary")
      .then((r) => r.json())
      .catch(() => ({ summary: null }))
      .then((res) => {
        if (cancelled) return;
        setSummary(res.summary ?? null);
        setSummaryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
      />

      <MemberKpiSummary summary={summary} loading={summaryLoading} />

      {/* The second, independent KPI: Search Console cannot see whether an
          article was any good, so a human grades that separately. It is stacked
          below rather than merged in — one number that averaged traffic growth
          with a review score would explain neither. */}
      <ContentReviewSummary />

      {/* The switcher sits below the KPI, next to what it actually controls.
          Putting it in the page header made it look like it governed everything
          on the page — including a score it cannot change. */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div>
          <h2 className="text-sm font-medium text-ink">Selected range diagnostics</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            The cards and table below follow this range. The KPI above does not.
          </p>
        </div>
        <RangeSwitcher
          value={range}
          onChange={(next) => {
            setLoading(true);
            setRange(next);
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          // Named for the range it belongs to: the KPI above is the score that
          // evaluates a member, this one only grades the window being inspected.
          label="Selected range score"
          value={scoreable ? formatScore(score?.kpi_score) : "—"}
          sub={
            !scoreable ? (
              `${RANGE_LABELS[range] ?? range} is not scored`
            ) : score ? (
              `${score.eligible_url_count} scored · ${score.excluded_url_count} excluded · ${score.no_data_url_count} no data`
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
