import { classifyGoogleApiError, queryUrlSearchAnalytics } from "@/lib/google";
import { computeGrowth, type PeriodMetrics } from "@/lib/performance/growth";
import { aggregateScore, computeUrlScore } from "@/lib/performance/score";
import { listContentUrlsByIds, listActiveContentUrls, type ContentUrl } from "@/lib/repositories/content-urls";
import { upsertPerformanceCache } from "@/lib/repositories/performance-cache";
import { advanceRefreshRun, createRefreshRun, finishRefreshRun, getRefreshRun, type RefreshRun } from "@/lib/repositories/refresh-runs";
import { getPerformanceRowsForRange } from "@/lib/repositories/performance-cache";
import { getKpiSettings } from "@/lib/repositories/kpi-settings";
import { upsertMemberScore, upsertProjectScore } from "@/lib/repositories/kpi-score-rollups";
import { getScoringInputRowsForRange, upsertUrlPerformanceScore } from "@/lib/repositories/url-performance-score";
import { upsertMemberRollup, upsertProjectRollup } from "@/lib/repositories/rollups";
import { computeRangeDates, isRollingRange, type RangeKey } from "@/lib/ranges";

export async function startRefresh(
  triggeredBy: string | null,
  rangeKey: RangeKey,
  custom?: { startDate: string; endDate: string },
): Promise<RefreshRun> {
  const range = computeRangeDates(rangeKey, custom);
  const urls = await listActiveContentUrls();
  return createRefreshRun(triggeredBy, range, urls.map((u) => u.id));
}

function isEligible(contentUrl: ContentUrl, endDate: string): boolean {
  if (!contentUrl.worked_at) return true;
  return contentUrl.worked_at <= endDate;
}

async function fetchMetrics(
  accessToken: string,
  gscProperty: string,
  url: string,
  startDate: string,
  endDate: string,
): Promise<{ metrics: PeriodMetrics | null; error: string | null }> {
  try {
    const row = await queryUrlSearchAnalytics(accessToken, gscProperty, url, startDate, endDate);
    return { metrics: row, error: null };
  } catch (error) {
    const kind = classifyGoogleApiError(error);
    const detail = (error as { message?: string })?.message ?? String(error);
    return { metrics: null, error: `${kind}: ${detail} (property: ${gscProperty})` };
  }
}

export async function processRefreshBatch(
  accessToken: string,
  refreshRunId: string,
  batchSize = 20,
): Promise<RefreshRun> {
  const run = await getRefreshRun(refreshRunId);
  if (!run) throw new Error("refresh_run not found");
  if (run.status !== "running") return run;

  const batchIds = run.pending_content_url_ids.slice(0, batchSize);
  if (batchIds.length === 0) {
    await maybeFinishRun(run);
    return (await getRefreshRun(refreshRunId)) ?? run;
  }

  const contentUrls = await listContentUrlsByIds(batchIds);
  let withData = 0;
  let noData = 0;
  let failed = 0;

  for (const contentUrl of contentUrls) {
    const eligible = isEligible(contentUrl, run.end_date);

    if (!eligible) {
      await upsertPerformanceCache({
        contentUrlId: contentUrl.id,
        rangeKey: run.range_key as RangeKey,
        startDate: run.start_date,
        endDate: run.end_date,
        previousStartDate: run.previous_start_date,
        previousEndDate: run.previous_end_date,
        growth: computeGrowth(null, null, false),
      });
      noData += 1;
      continue;
    }

    if (!contentUrl.gsc_property) {
      await upsertPerformanceCache({
        contentUrlId: contentUrl.id,
        rangeKey: run.range_key as RangeKey,
        startDate: run.start_date,
        endDate: run.end_date,
        previousStartDate: run.previous_start_date,
        previousEndDate: run.previous_end_date,
        growth: { ...computeGrowth(null, null, true), dataStatus: "error" },
        errorMessage: `No Search Console property mapped for project "${contentUrl.project}". Set it in Admin → Settings.`,
      });
      failed += 1;
      continue;
    }

    const current = await fetchMetrics(accessToken, contentUrl.gsc_property, contentUrl.url, run.start_date, run.end_date);
    const previous = run.previous_start_date && run.previous_end_date
      ? await fetchMetrics(accessToken, contentUrl.gsc_property, contentUrl.url, run.previous_start_date, run.previous_end_date)
      : { metrics: null, error: null };

    if (current.error) {
      await upsertPerformanceCache({
        contentUrlId: contentUrl.id,
        rangeKey: run.range_key as RangeKey,
        startDate: run.start_date,
        endDate: run.end_date,
        previousStartDate: run.previous_start_date,
        previousEndDate: run.previous_end_date,
        growth: { ...computeGrowth(null, null, true), dataStatus: "error" },
        errorMessage: current.error,
      });
      failed += 1;
      continue;
    }

    const growth = computeGrowth(current.metrics, previous.metrics, true);
    await upsertPerformanceCache({
      contentUrlId: contentUrl.id,
      rangeKey: run.range_key as RangeKey,
      startDate: run.start_date,
      endDate: run.end_date,
      previousStartDate: run.previous_start_date,
      previousEndDate: run.previous_end_date,
      growth,
    });

    if (growth.dataStatus === "ok") withData += 1;
    else noData += 1;
  }

  const updated = await advanceRefreshRun(refreshRunId, batchIds, { withData, noData, failed });
  await maybeFinishRun(updated);
  return (await getRefreshRun(refreshRunId)) ?? updated;
}

async function maybeFinishRun(run: RefreshRun): Promise<void> {
  if (run.status === "running" && run.pending_content_url_ids.length === 0) {
    const rangeKey = run.range_key as RangeKey;
    await computeAndStoreRollups(rangeKey, run.start_date, run.end_date);
    // KPI is a growth measure, so it only exists where a previous period does.
    // all_time and custom are skipped outright rather than scored against nothing.
    if (isRollingRange(rangeKey)) {
      await computeAndStoreScores(rangeKey, run.start_date, run.end_date);
    }
    await finishRefreshRun(run.id, "success");
  }
}

export async function computeAndStoreRollups(rangeKey: RangeKey, startDate: string, endDate: string): Promise<void> {
  const rows = await getPerformanceRowsForRange(rangeKey);

  const byMember = new Map<string, typeof rows>();
  const byProject = new Map<string, typeof rows>();

  for (const row of rows) {
    const memberKey = row.member_name || "(unassigned)";
    const projectKey = row.project || "(unassigned)";
    if (!byMember.has(memberKey)) byMember.set(memberKey, []);
    if (!byProject.has(projectKey)) byProject.set(projectKey, []);
    byMember.get(memberKey)!.push(row);
    byProject.get(projectKey)!.push(row);
  }

  for (const [memberName, memberRows] of byMember) {
    const summary = summarize(memberRows);
    const email = memberRows.find((r) => r.member_email)?.member_email ?? null;
    await upsertMemberRollup(email, {
      key: memberName,
      rangeKey,
      startDate,
      endDate,
      ...summary,
    });
  }

  for (const [project, projectRows] of byProject) {
    const summary = summarize(projectRows);
    await upsertProjectRollup({
      key: project,
      rangeKey,
      startDate,
      endDate,
      ...summary,
    });
  }
}

/**
 * Grade an already-refreshed range and roll the scores up to member and project.
 *
 * Reads only from seo_performance_cache — no Search Console calls — so it is
 * safe to re-run on demand after an admin changes a project type, excludes a
 * URL, or retunes kpi_settings, without spending API quota.
 */
export async function computeAndStoreScores(rangeKey: RangeKey, startDate: string, endDate: string): Promise<void> {
  const settings = await getKpiSettings();
  const rows = await getScoringInputRowsForRange(rangeKey);

  const scored = rows.map((row) => ({
    row,
    result: computeUrlScore(
      {
        projectType: row.project_type,
        dataStatus: row.data_status,
        growthStatus: row.growth_status,
        kpiExcluded: row.kpi_excluded,
        workedAt: row.worked_at,
        endDate,
        previousEndDate: row.previous_end_date,
        clickGrowthPct: row.click_growth_pct,
        impressionGrowthPct: row.impression_growth_pct,
        currentImpressions: row.current_impressions,
        previousImpressions: row.previous_impressions,
      },
      settings,
    ),
  }));

  for (const { row, result } of scored) {
    await upsertUrlPerformanceScore({
      contentUrlId: row.content_url_id,
      rangeKey,
      startDate,
      endDate,
      projectType: row.project_type,
      clickGrowthPct: row.click_growth_pct,
      impressionGrowthPct: row.impression_growth_pct,
      result,
    });
  }

  const byMember = new Map<string, typeof scored>();
  const byProject = new Map<string, typeof scored>();
  for (const item of scored) {
    const memberKey = item.row.member_name || "(unassigned)";
    const projectKey = item.row.project || "(unassigned)";
    if (!byMember.has(memberKey)) byMember.set(memberKey, []);
    if (!byProject.has(projectKey)) byProject.set(projectKey, []);
    byMember.get(memberKey)!.push(item);
    byProject.get(projectKey)!.push(item);
  }

  for (const [memberName, items] of byMember) {
    const aggregate = aggregateScore(
      items.map((i) => i.result),
      settings.urlWeightCapPct,
    );
    const email = items.find((i) => i.row.member_email)?.row.member_email ?? null;
    await upsertMemberScore(email, { key: memberName, rangeKey, startDate, endDate, ...aggregate });
  }

  for (const [project, items] of byProject) {
    const aggregate = aggregateScore(
      items.map((i) => i.result),
      settings.urlWeightCapPct,
    );
    await upsertProjectScore({ key: project, rangeKey, startDate, endDate, ...aggregate });
  }
}

/**
 * Aggregate counterpart to the per-URL growthPct in ./growth.ts, with the extra
 * "no previous period at all" case that only exists once rows are combined.
 */
function growthPct(previous: number | null, current: number): number | null {
  if (previous === null) return null;
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function summarize(rows: Array<{
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
  previous_clicks: number | null;
  previous_impressions: number | null;
  growth_status: string;
  data_status: string;
}>) {
  const okRows = rows.filter((r) => r.data_status === "ok");
  // pg returns `numeric` columns as strings (it won't silently narrow arbitrary
  // precision into a JS number) — Number(...) here is load-bearing, not
  // decorative. Without it "+" on two numeric-as-string values concatenates
  // digits instead of adding them.
  const clicks = okRows.reduce((sum, r) => sum + Number(r.clicks ?? 0), 0);
  const impressions = okRows.reduce((sum, r) => sum + Number(r.impressions ?? 0), 0);
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const positionRows = okRows.filter((r) => r.position !== null);
  const position = positionRows.length
    ? positionRows.reduce((sum, r) => sum + Number(r.position ?? 0), 0) / positionRows.length
    : null;

  // all_time has no previous window, so every row's previous_* is null. Summing
  // those as 0 would make the delta equal the entire period's clicks and report
  // "+100%" growth out of nothing. No comparable period means no comparison.
  const hasPrevious = okRows.some((r) => r.previous_clicks !== null || r.previous_impressions !== null);
  const previousClicks = hasPrevious ? okRows.reduce((sum, r) => sum + Number(r.previous_clicks ?? 0), 0) : null;
  const previousImpressions = hasPrevious
    ? okRows.reduce((sum, r) => sum + Number(r.previous_impressions ?? 0), 0)
    : null;

  const clickDelta = previousClicks === null ? null : clicks - previousClicks;
  const impressionDelta = previousImpressions === null ? null : impressions - previousImpressions;
  const clickGrowthPct = growthPct(previousClicks, clicks);
  const impressionGrowthPct = growthPct(previousImpressions, impressions);

  return {
    urlCount: rows.length,
    urlsWithData: okRows.length,
    growingUrls: rows.filter((r) => r.growth_status === "growing" || r.growth_status === "new_signal").length,
    stableUrls: rows.filter((r) => r.growth_status === "stable").length,
    decliningUrls: rows.filter((r) => r.growth_status === "declining").length,
    noDataUrls: rows.filter((r) => r.data_status !== "ok").length,
    clicks,
    impressions,
    ctr,
    position,
    previousClicks,
    previousImpressions,
    clickDelta,
    clickGrowthPct,
    impressionDelta,
    impressionGrowthPct,
  };
}
