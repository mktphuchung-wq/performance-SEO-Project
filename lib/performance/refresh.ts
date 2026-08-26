import { mapWithConcurrency, withRetry } from "@/lib/concurrency";
import { withTransaction } from "@/lib/db";
import { getSyncGscConcurrency, isSyncGscWideQueryEnabled } from "@/lib/env";
import {
  classifyGoogleApiError,
  queryAllPagesSearchAnalytics,
  queryUrlSearchAnalytics,
  type SearchAnalyticsRow,
} from "@/lib/google";
import { computeGrowth, type PeriodMetrics } from "@/lib/performance/growth";
import { aggregateScore, computeUrlScore } from "@/lib/performance/score";
import { listActiveContentUrls, listActiveContentUrlsByIds, type ContentUrl } from "@/lib/repositories/content-urls";
import { bulkUpsertPerformanceCache, getPerformanceRowsForRange, type UpsertPerformanceCacheInput } from "@/lib/repositories/performance-cache";
import {
  advanceRefreshRun,
  claimRefreshRun,
  createRefreshRun,
  finishRefreshRun,
  getRefreshRun,
  heartbeatRefreshRun,
  recordRefreshTimings,
  type RefreshRun,
} from "@/lib/repositories/refresh-runs";
import { getKpiSettings } from "@/lib/repositories/kpi-settings";
import { upsertMemberScore, upsertProjectScore } from "@/lib/repositories/kpi-score-rollups";
import { getScoringInputRowsForRange, upsertUrlPerformanceScore } from "@/lib/repositories/url-performance-score";
import { upsertMemberRollup, upsertProjectRollup } from "@/lib/repositories/rollups";
import { computeRangeDates, isRollingRange, type RangeKey } from "@/lib/ranges";
import { normalizeForGscMatch } from "@/lib/sync/normalize-url";

export async function startRefresh(
  triggeredBy: string | null,
  rangeKey: RangeKey,
  custom?: { startDate: string; endDate: string },
): Promise<RefreshRun> {
  const range = computeRangeDates(rangeKey, custom);
  const urls = await listActiveContentUrls();
  return createRefreshRun(triggeredBy, range, urls.map((url) => url.id));
}

function isEligible(contentUrl: ContentUrl, endDate: string): boolean {
  return !contentUrl.worked_at || contentUrl.worked_at <= endDate;
}

function apiError(error: unknown, property: string): string {
  const kind = classifyGoogleApiError(error);
  const detail = (error as { message?: string })?.message ?? String(error);
  return `${kind}: ${detail} (property: ${property})`;
}

function cacheInput(run: RefreshRun, contentUrl: ContentUrl, growth: ReturnType<typeof computeGrowth>, errorMessage?: string): UpsertPerformanceCacheInput {
  return {
    contentUrlId: contentUrl.id,
    rangeKey: run.range_key as RangeKey,
    startDate: run.start_date,
    endDate: run.end_date,
    previousStartDate: run.previous_start_date,
    previousEndDate: run.previous_end_date,
    growth,
    errorMessage,
  };
}

async function fetchExactMetrics(
  accessToken: string,
  property: string,
  url: string,
  startDate: string,
  endDate: string,
  countCall: () => void,
): Promise<SearchAnalyticsRow | null> {
  return withRetry(() => queryUrlSearchAnalytics(accessToken, property, url, startDate, endDate), { onAttempt: countCall });
}

async function propertyInputs(
  accessToken: string,
  run: RefreshRun,
  property: string,
  urls: ContentUrl[],
  countCall: () => void,
): Promise<UpsertPerformanceCacheInput[]> {
  if (!isSyncGscWideQueryEnabled()) {
    return mapWithConcurrency(urls, getSyncGscConcurrency(), async (contentUrl) => {
      try {
        const current = await fetchExactMetrics(accessToken, property, contentUrl.url, run.start_date, run.end_date, countCall);
        const previous = run.previous_start_date && run.previous_end_date
          ? await fetchExactMetrics(accessToken, property, contentUrl.url, run.previous_start_date, run.previous_end_date, countCall)
          : null;
        return cacheInput(run, contentUrl, computeGrowth(current, previous, true));
      } catch (error) {
        const kind = classifyGoogleApiError(error);
        if (kind === "invalid_credentials" || kind === "rate_limited" || kind === "transient") throw error;
        return cacheInput(run, contentUrl, { ...computeGrowth(null, null, true), dataStatus: "error" }, apiError(error, property));
      }
    });
  }

  try {
    const currentRows = await queryAllPagesSearchAnalytics(accessToken, property, run.start_date, run.end_date, countCall);
    const previousRows = run.previous_start_date && run.previous_end_date
      ? await queryAllPagesSearchAnalytics(accessToken, property, run.previous_start_date, run.previous_end_date, countCall)
      : [];
    const current = new Map<string, PeriodMetrics>();
    const previous = new Map<string, PeriodMetrics>();
    for (const row of currentRows) current.set(normalizeForGscMatch(row.pageUrl), row);
    for (const row of previousRows) previous.set(normalizeForGscMatch(row.pageUrl), row);
    return urls.map((contentUrl) => {
      const key = normalizeForGscMatch(contentUrl.url);
      return cacheInput(run, contentUrl, computeGrowth(current.get(key) ?? null, previous.get(key) ?? null, true));
    });
  } catch (error) {
    const kind = classifyGoogleApiError(error);
    if (kind === "invalid_credentials" || kind === "rate_limited" || kind === "transient") throw error;
    if (kind === "permission_denied") {
      const message = apiError(error, property);
      return urls.map((contentUrl) => cacheInput(
        run,
        contentUrl,
        { ...computeGrowth(null, null, true), dataStatus: "error" },
        message,
      ));
    }

    // Some very large properties reject an unfiltered query. Preserve correctness
    // by falling back to bounded exact-page requests for only the tracked URLs.
    return mapWithConcurrency(urls, getSyncGscConcurrency(), async (contentUrl) => {
      try {
        const current = await fetchExactMetrics(accessToken, property, contentUrl.url, run.start_date, run.end_date, countCall);
        const previous = run.previous_start_date && run.previous_end_date
          ? await fetchExactMetrics(accessToken, property, contentUrl.url, run.previous_start_date, run.previous_end_date, countCall)
          : null;
        return cacheInput(run, contentUrl, computeGrowth(current, previous, true));
      } catch (fallbackError) {
        const fallbackKind = classifyGoogleApiError(fallbackError);
        if (fallbackKind === "invalid_credentials" || fallbackKind === "rate_limited" || fallbackKind === "transient") {
          throw fallbackError;
        }
        return cacheInput(run, contentUrl, { ...computeGrowth(null, null, true), dataStatus: "error" }, apiError(fallbackError, property));
      }
    });
  }
}

async function processRunUrls(accessToken: string, run: RefreshRun, batchIds: string[]): Promise<RefreshRun> {
  const contentUrls = await listActiveContentUrlsByIds(batchIds);
  const activeIds = new Set(contentUrls.map((url) => url.id));
  const inputs: UpsertPerformanceCacheInput[] = [];
  const byProperty = new Map<string, ContentUrl[]>();

  for (const contentUrl of contentUrls) {
    if (!isEligible(contentUrl, run.end_date)) {
      inputs.push(cacheInput(run, contentUrl, computeGrowth(null, null, false)));
    } else if (!contentUrl.gsc_property) {
      inputs.push(cacheInput(
        run,
        contentUrl,
        { ...computeGrowth(null, null, true), dataStatus: "error" },
        `No Search Console property mapped for project "${contentUrl.project}". Set it in Admin -> Settings.`,
      ));
    } else {
      const grouped = byProperty.get(contentUrl.gsc_property) ?? [];
      grouped.push(contentUrl);
      byProperty.set(contentUrl.gsc_property, grouped);
    }
  }

  let gscCallCount = 0;
  const gscStarted = Date.now();
  const propertyResults = await mapWithConcurrency(
    [...byProperty.entries()],
    getSyncGscConcurrency(),
    ([property, urls]) => propertyInputs(accessToken, run, property, urls, () => { gscCallCount += 1; }),
  );
  inputs.push(...propertyResults.flat());
  const gscQueryMs = Date.now() - gscStarted;

  let withData = 0;
  let noData = batchIds.length - activeIds.size;
  let failed = 0;
  for (const input of inputs) {
    if (input.growth.dataStatus === "ok") withData += 1;
    else if (input.growth.dataStatus === "error") failed += 1;
    else noData += 1;
  }

  await heartbeatRefreshRun(run.id);
  const dbStarted = Date.now();
  const updated = await withTransaction(async (client) => {
    await bulkUpsertPerformanceCache(inputs, client);
    return advanceRefreshRun(run.id, batchIds, { withData, noData, failed }, client);
  });
  const dbWriteMs = Date.now() - dbStarted;
  await recordRefreshTimings(run.id, { gscQueryMs, dbWriteMs, gscCallCount });
  return updated;
}

export async function processRefreshBatch(accessToken: string, refreshRunId: string, batchSize = 20): Promise<RefreshRun> {
  let run = await getRefreshRun(refreshRunId);
  if (!run) throw new Error("refresh_run not found");
  if (run.status === "queued") {
    if (!(await claimRefreshRun(refreshRunId))) return (await getRefreshRun(refreshRunId)) ?? run;
    run = (await getRefreshRun(refreshRunId)) ?? run;
  }
  if (run.status !== "running") return run;
  const safeBatchSize = Math.max(1, Math.min(Math.floor(batchSize), 1000));
  const batchIds = run.pending_content_url_ids.slice(0, safeBatchSize);
  if (batchIds.length > 0) run = await processRunUrls(accessToken, run, batchIds);
  await maybeFinishRun(run);
  return (await getRefreshRun(refreshRunId)) ?? run;
}

export async function drainRefreshRun(accessToken: string, refreshRunId: string): Promise<void> {
  try {
    let run = await getRefreshRun(refreshRunId);
    if (!run) throw new Error("refresh_run not found");
    if (run.status === "queued") {
      if (!(await claimRefreshRun(refreshRunId))) return;
      run = (await getRefreshRun(refreshRunId)) ?? run;
    }
    while (run.status === "running" && run.pending_content_url_ids.length > 0) {
      run = await processRunUrls(accessToken, run, run.pending_content_url_ids);
    }
    await maybeFinishRun(run);
  } catch (error) {
    await finishRefreshRun(refreshRunId, "failed", (error as Error).message);
    throw error;
  }
}

async function maybeFinishRun(run: RefreshRun): Promise<void> {
  if (run.status !== "running" || run.pending_content_url_ids.length > 0) return;
  const rangeKey = run.range_key as RangeKey;
  await computeAndStoreRollups(rangeKey, run.start_date, run.end_date);
  if (isRollingRange(rangeKey)) await computeAndStoreScores(rangeKey, run.start_date, run.end_date);
  await finishRefreshRun(run.id, "success");
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
    const email = memberRows.find((row) => row.member_email)?.member_email ?? null;
    await upsertMemberRollup(email, { key: memberName, rangeKey, startDate, endDate, ...summarize(memberRows) });
  }
  for (const [project, projectRows] of byProject) {
    await upsertProjectRollup({ key: project, rangeKey, startDate, endDate, ...summarize(projectRows) });
  }
}

export async function computeAndStoreScores(rangeKey: RangeKey, startDate: string, endDate: string): Promise<void> {
  const settings = await getKpiSettings();
  const rows = await getScoringInputRowsForRange(rangeKey);
  const scored = rows.map((row) => ({
    row,
    result: computeUrlScore({
      projectType: row.project_type,
      dataStatus: row.data_status,
      kpiExcluded: row.kpi_excluded,
      currentClicks: row.current_clicks,
      previousClicks: row.previous_clicks,
      currentImpressions: row.current_impressions,
      previousImpressions: row.previous_impressions,
    }, settings),
  }));
  for (const { row, result } of scored) {
    await upsertUrlPerformanceScore({ contentUrlId: row.content_url_id, rangeKey, startDate, endDate, projectType: row.project_type, result });
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
    const aggregate = aggregateScore(items.map((item) => item.result), settings.urlWeightCapPct);
    const email = items.find((item) => item.row.member_email)?.row.member_email ?? null;
    await upsertMemberScore(email, { key: memberName, rangeKey, startDate, endDate, ...aggregate });
  }
  for (const [project, items] of byProject) {
    const aggregate = aggregateScore(items.map((item) => item.result), settings.urlWeightCapPct);
    await upsertProjectScore({ key: project, rangeKey, startDate, endDate, ...aggregate });
  }
}

function growthPct(previous: number | null, current: number): number | null {
  if (previous === null) return null;
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function summarize(rows: Array<{
  clicks: number | null; impressions: number | null; ctr: number | null; position: number | null;
  previous_clicks: number | null; previous_impressions: number | null; growth_status: string; data_status: string;
}>) {
  const okRows = rows.filter((row) => row.data_status === "ok");
  const clicks = okRows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
  const impressions = okRows.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const positionRows = okRows.filter((row) => row.position !== null);
  const position = positionRows.length
    ? positionRows.reduce((sum, row) => sum + Number(row.position ?? 0), 0) / positionRows.length
    : null;
  const hasPrevious = okRows.some((row) => row.previous_clicks !== null || row.previous_impressions !== null);
  const previousClicks = hasPrevious ? okRows.reduce((sum, row) => sum + Number(row.previous_clicks ?? 0), 0) : null;
  const previousImpressions = hasPrevious ? okRows.reduce((sum, row) => sum + Number(row.previous_impressions ?? 0), 0) : null;
  const clickDelta = previousClicks === null ? null : clicks - previousClicks;
  const impressionDelta = previousImpressions === null ? null : impressions - previousImpressions;
  return {
    urlCount: rows.length,
    urlsWithData: okRows.length,
    growingUrls: rows.filter((row) => row.growth_status === "growing" || row.growth_status === "new_signal").length,
    stableUrls: rows.filter((row) => row.growth_status === "stable").length,
    decliningUrls: rows.filter((row) => row.growth_status === "declining").length,
    noDataUrls: rows.filter((row) => row.data_status !== "ok").length,
    clicks,
    impressions,
    ctr,
    position,
    previousClicks,
    previousImpressions,
    clickDelta,
    clickGrowthPct: growthPct(previousClicks, clicks),
    impressionDelta,
    impressionGrowthPct: growthPct(previousImpressions, impressions),
  };
}
