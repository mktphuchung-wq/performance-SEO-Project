"use client";

import { useEffect, useState } from "react";
import { ContentKpiCard, type ContentKpiCardData } from "@/components/ContentKpiCard";
import { ContentReviewSummary } from "@/components/ContentReviewSummary";
import { MemberKpiSummary } from "@/components/MemberKpiSummary";
import { MemberWarningsCard, type MemberWarningRow } from "@/components/MemberWarningsCard";
import { MetricDeltaInline } from "@/components/MetricDelta";
import { PerformanceTable, type PerformanceTableRow } from "@/components/PerformanceTable";
import { RangeSwitcher } from "@/components/RangeSwitcher";
import { StatCard } from "@/components/StatCard";
import { Button, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { fetchJson, messageOf } from "@/lib/http/fetch-json";
import { RANGE_LABELS, formatCtr, formatNumber, formatScore } from "@/lib/format";
import type { MemberCompositeKpi } from "@/lib/performance/composite-score";
import type { ContentReviewBatch } from "@/lib/repositories/content-review";
import type { MemberScoreRow } from "@/lib/repositories/kpi-score-rollups";
import type { MemberRollupRow } from "@/lib/repositories/rollups";
import { DEFAULT_RANGE_KEY, isRollingRange, type RangeKey } from "@/lib/ranges";

type RowsResponse = { rows: PerformanceTableRow[] };
type RollupResponse = { rollup: MemberRollupRow | null };
type ScoreResponse = { score: MemberScoreRow | null };
type SummaryResponse = { summary: MemberCompositeKpi | null };
type ContentResponse = ContentKpiCardData & { history: ContentReviewBatch[] };
type WarningsResponse = { rows: MemberWarningRow[] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const hasPerformanceRows = (value: unknown): value is RowsResponse => isObject(value) && Array.isArray(value.rows);
const hasWarningRows = (value: unknown): value is WarningsResponse => isObject(value) && Array.isArray(value.rows);
const hasRollup = (value: unknown): value is RollupResponse => isObject(value) && "rollup" in value;
const hasScore = (value: unknown): value is ScoreResponse => isObject(value) && "score" in value;
const hasSummary = (value: unknown): value is SummaryResponse => isObject(value) && "summary" in value;
const hasContent = (value: unknown): value is ContentResponse => isObject(value) && Array.isArray(value.history) && typeof value.scoredMonthCount === "number";

export default function DashboardPage() {
  const [range, setRange] = useState<string>(DEFAULT_RANGE_KEY);
  const [rangeRevision, setRangeRevision] = useState(0);
  const [staticRevision, setStaticRevision] = useState(0);
  const [rows, setRows] = useState<PerformanceTableRow[]>([]);
  const [rollup, setRollup] = useState<MemberRollupRow | null>(null);
  const [score, setScore] = useState<MemberScoreRow | null>(null);
  const [rangeLoading, setRangeLoading] = useState(true);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [scoreLoading, setScoreLoading] = useState(true);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MemberCompositeKpi | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [contentKpi, setContentKpi] = useState<ContentKpiCardData | null>(null);
  const [contentHistory, setContentHistory] = useState<ContentReviewBatch[]>([]);
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<MemberWarningRow[]>([]);
  const [warningsLoading, setWarningsLoading] = useState(true);
  const [warningsError, setWarningsError] = useState<string | null>(null);

  const scoreable = isRollingRange(range as RangeKey);

  useEffect(() => {
    const controller = new AbortController();
    setRangeLoading(true);
    setRangeError(null);
    setRows([]);
    setRollup(null);
    void Promise.all([
      fetchJson<RowsResponse>(`/api/me/urls?range=${range}`, { signal: controller.signal }, hasPerformanceRows),
      fetchJson<RollupResponse>(`/api/me/performance?range=${range}`, { signal: controller.signal }, hasRollup),
    ])
      .then(([urls, performance]) => {
        if (controller.signal.aborted) return;
        setRows(urls.rows);
        setRollup(performance.rollup);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setRangeError(messageOf(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setRangeLoading(false);
      });
    return () => controller.abort();
  }, [range, rangeRevision]);

  useEffect(() => {
    const controller = new AbortController();
    setScoreLoading(true);
    setScoreError(null);
    setScore(null);
    void fetchJson<ScoreResponse>(`/api/me/kpi?range=${range}`, { signal: controller.signal }, hasScore)
      .then((body) => {
        if (!controller.signal.aborted) setScore(body.score);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setScoreError(messageOf(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setScoreLoading(false);
      });
    return () => controller.abort();
  }, [range, rangeRevision]);

  useEffect(() => {
    const controller = new AbortController();
    setSummaryLoading(true);
    setSummaryError(null);
    setSummary(null);
    void fetchJson<SummaryResponse>("/api/me/kpi-summary", { signal: controller.signal }, hasSummary)
      .then((body) => !controller.signal.aborted && setSummary(body.summary))
      .catch((error: unknown) => !controller.signal.aborted && setSummaryError(messageOf(error)))
      .finally(() => !controller.signal.aborted && setSummaryLoading(false));
    return () => controller.abort();
  }, [staticRevision]);

  useEffect(() => {
    const controller = new AbortController();
    setContentLoading(true);
    setContentError(null);
    setContentKpi(null);
    setContentHistory([]);
    void fetchJson<ContentResponse>("/api/me/content-review", { signal: controller.signal }, hasContent)
      .then((body) => {
        if (controller.signal.aborted) return;
        const { history, ...card } = body;
        setContentKpi(card);
        setContentHistory(history);
      })
      .catch((error: unknown) => !controller.signal.aborted && setContentError(messageOf(error)))
      .finally(() => !controller.signal.aborted && setContentLoading(false));
    return () => controller.abort();
  }, [staticRevision]);

  useEffect(() => {
    const controller = new AbortController();
    setWarningsLoading(true);
    setWarningsError(null);
    setWarnings([]);
    void fetchJson<WarningsResponse>("/api/me/warnings", { signal: controller.signal }, hasWarningRows)
      .then((body) => !controller.signal.aborted && setWarnings(body.rows))
      .catch((error: unknown) => !controller.signal.aborted && setWarningsError(messageOf(error)))
      .finally(() => !controller.signal.aborted && setWarningsLoading(false));
    return () => controller.abort();
  }, [staticRevision]);

  const warningLevelByUrlId = warnings.reduce<Record<string, string>>((acc, warning) => {
    if (warning.resolved_at === null && acc[warning.content_url_id] !== "mandatory_audit") acc[warning.content_url_id] = warning.level;
    return acc;
  }, {});

  function changeRange(next: string) {
    setRows([]);
    setRollup(null);
    setScore(null);
    setRangeLoading(true);
    setScoreLoading(true);
    setRangeError(null);
    setScoreError(null);
    setRange(next);
  }

  function retry() {
    setRangeRevision((value) => value + 1);
    setStaticRevision((value) => value + 1);
  }

  const rangeFailed = Boolean(rangeError || scoreError);
  const rangeEmpty = !rangeLoading && !rangeError && rows.length === 0 && rollup === null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-5 py-6">
      <PageHeader title="My performance" description="URLs assigned to you in the content sheet, measured in Search Console." />

      {summaryError && <p className="rounded-lg bg-negative-soft px-4 py-3 text-[13px] text-negative">Performance KPI: {summaryError}</p>}
      <MemberKpiSummary summary={summary} loading={summaryLoading} error={summaryError} />

      {contentError ? (
        <p className="rounded-lg bg-negative-soft px-4 py-3 text-[13px] text-negative">Content KPI: {contentError}</p>
      ) : (
        <>
          <ContentKpiCard data={contentKpi} loading={contentLoading} />
          <ContentReviewSummary history={contentHistory} loading={contentLoading} />
        </>
      )}

      <MemberWarningsCard rows={warnings} loading={warningsLoading} error={warningsError} />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div>
          <h2 className="text-sm font-medium text-ink">Selected range diagnostics</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">The cards and table below follow this range. The KPI above does not.</p>
        </div>
        <RangeSwitcher value={range} onChange={changeRange} />
      </div>

      {rangeFailed && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-negative-soft px-4 py-3 text-[13px] text-negative">
          <span>{rangeError ?? scoreError}</span>
          <Button variant="secondary" onClick={retry}>Try again</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Selected range score"
          value={scoreLoading || scoreError || !scoreable ? "â€”" : formatScore(score?.kpi_score)}
          sub={!scoreable ? `${RANGE_LABELS[range] ?? range} is not scored` : scoreLoading ? "Loadingâ€¦" : scoreError ? "Could not load score" : score ? `${score.eligible_url_count} scored · ${score.excluded_url_count} excluded · ${score.no_data_url_count} no data` : "No eligible URL yet"}
        />
        <StatCard label="URLs" value={rangeLoading || rangeError ? "â€”" : rollup ? String(rollup.url_count) : "â€”"} sub={rangeLoading ? "Loadingâ€¦" : rangeError ? "Could not load data" : rollup ? `${rollup.urls_with_data} with data` : "No performance data yet"} />
        <StatCard label="Clicks" value={rangeLoading || rangeError ? "â€”" : formatNumber(rollup?.clicks)} sub={rollup && !rangeLoading && !rangeError ? <MetricDeltaInline delta={rollup.click_delta} pct={rollup.click_growth_pct} previous={rollup.previous_clicks} /> : undefined} />
        <StatCard label="Impressions" value={rangeLoading || rangeError ? "â€”" : formatNumber(rollup?.impressions)} sub={rollup && !rangeLoading && !rangeError ? <MetricDeltaInline delta={rollup.impression_delta} pct={rollup.impression_growth_pct} previous={rollup.previous_impressions} /> : undefined} />
        <StatCard label="CTR" value={rangeLoading || rangeError ? "â€”" : formatCtr(rollup?.ctr)} sub={rollup ? "clicks ÷ impressions" : undefined} />
        <StatCard label="Growing / Declining" value={rangeLoading || rangeError ? "â€”" : rollup ? `${rollup.growing_urls} / ${rollup.declining_urls}` : "â€”"} sub={rollup ? `${rollup.no_data_urls} without data` : undefined} />
      </div>

      <Card>
        <CardHeader title="My URLs" description={`${RANGE_LABELS[range] ?? range} — click a URL to see every range side by side.`} />
        {rangeLoading ? <p className="px-5 py-10 text-center text-sm text-ink-muted">Loading…</p> : rangeError ? <EmptyState title="Performance data could not be loaded" hint="Use Try again above after the data service recovers." /> : rangeEmpty ? <EmptyState title="No performance data yet" hint="Ask an admin to sync the content sheet and refresh Search Console data." /> : <PerformanceTable rows={rows} warningLevelByUrlId={warningLevelByUrlId} />}
      </Card>
    </div>
  );
}
