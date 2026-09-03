import { createLimiter, withRetry } from "@/lib/concurrency";
import { withTransaction, type DbExecutor } from "@/lib/db";
import {
  getSyncGscConcurrency,
  getSyncGscExactChunkSize,
  getSyncGscMaxRequestsPerRun,
  getSyncGscRequestTimeoutMs,
  getSyncGscRetryAttempts,
  isSyncGscWideQueryEnabled,
} from "@/lib/env";
import {
  queryAllPagesSearchAnalytics,
  queryUrlSearchAnalytics,
  type SearchAnalyticsRow,
} from "@/lib/google";
import { classifyGoogleApiError, isWideQueryUnsupported } from "@/lib/google-errors";
import { attributionIndex, groupByMemberAndProject } from "@/lib/performance/attribution";
import { computeGrowth, type PeriodMetrics } from "@/lib/performance/growth";
import { evaluateWarningsForClosedMonth } from "@/lib/performance/warning-evaluation";
import { periodTotals } from "@/lib/performance/period-totals";
import {
  OPPOSITE_SIGN_FACTOR,
  aggregateMemberScore,
  aggregateScore,
  computeUrlScore,
  robustBaseline,
} from "@/lib/performance/score";
import {
  getMonthlyHistoryForUrls,
  isBaselineEligible,
} from "@/lib/repositories/content-url-monthly-metrics";
import { getUrlAttributionForRange } from "@/lib/repositories/content-url-works";
import { listActiveContentUrls, listContentUrlsByIds, type ContentUrl } from "@/lib/repositories/content-urls";
import { getBaselineSettings, getKpiSettings } from "@/lib/repositories/kpi-settings";
import { upsertMemberScore, upsertProjectScore } from "@/lib/repositories/kpi-score-rollups";
import {
  bulkStagePerformanceCache,
  getPerformanceRowsForRange,
  getStagedPerformanceCount,
  publishStagedPerformanceCache,
  type UpsertPerformanceCacheInput,
} from "@/lib/repositories/performance-cache";
import {
  claimNextRefreshItem,
  completeRefreshItem,
  createRefreshRun,
  deferRefreshItem,
  finishRefreshRun,
  getRefreshRun,
  heartbeatRefreshWork,
  setRefreshPhase,
  splitRefreshItemForExactFallback,
  type RefreshRun,
  type RefreshRunItem,
} from "@/lib/repositories/refresh-runs";
import { upsertMemberRollup, upsertProjectRollup } from "@/lib/repositories/rollups";
import { bulkUpsertUrlPerformanceScores, getScoringInputRowsForRange } from "@/lib/repositories/url-performance-score";
import { baselineWindows, closedCalendarMonths, computeRangeDates, isRollingRange, type RangeKey } from "@/lib/ranges";
import { normalizeForGscMatch } from "@/lib/sync/normalize-url";

export async function startRefresh(triggeredBy: string | null, rangeKey: RangeKey): Promise<RefreshRun> {
  const range = computeRangeDates(rangeKey);
  return createRefreshRun(triggeredBy, range, await listActiveContentUrls());
}

/**
 * A URL is only "not there yet" when the first thing anyone did to it was create
 * it, and that had not happened by the end of the window.
 *
 * This reads published_at, never worked_at. Auditing or updating an already-live
 * URL is work done *on* it, and says nothing about when it went live — treating
 * the audit date as a birth date is what used to throw away the real Search
 * Console history of long-lived pages the moment somebody audited them.
 */
function isEligible(contentUrl: ContentUrl, endDate: string): boolean {
  return !contentUrl.published_at || contentUrl.published_at <= endDate;
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

function errorInputs(run: RefreshRun, urls: ContentUrl[], message: string): UpsertPerformanceCacheInput[] {
  return urls.map((url) => cacheInput(run, url, { ...computeGrowth(null, null, true), dataStatus: "error" }, message));
}

function countOutcomes(inputs: UpsertPerformanceCacheInput[]) {
  return inputs.reduce((counts, input) => {
    if (input.growth.dataStatus === "ok") counts.withData += 1;
    else if (input.growth.dataStatus === "error") counts.failed += 1;
    else counts.noData += 1;
    return counts;
  }, { withData: 0, noData: 0, failed: 0 });
}

function startHeartbeat(runId: string, itemId: string, leaseOwner: string): () => void {
  const timer = setInterval(() => {
    void heartbeatRefreshWork(runId, itemId, leaseOwner).catch((error) => {
      console.error(`Could not heartbeat refresh item ${itemId}`, error);
    });
  }, 10_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

interface CallCounters {
  apiCalls: number;
  retries: number;
}

function countAttempt(counters: CallCounters, run: RefreshRun): void {
  counters.apiCalls += 1;
  if (run.gsc_call_count + counters.apiCalls > getSyncGscMaxRequestsPerRun()) {
    throw new Error(`Search Console request budget exceeded (${getSyncGscMaxRequestsPerRun()} calls)`);
  }
}

async function fetchWidePeriod(
  accessToken: string,
  run: RefreshRun,
  property: string,
  startDate: string,
  endDate: string,
  counters: CallCounters,
): Promise<Map<string, PeriodMetrics>> {
  const rows = await queryAllPagesSearchAnalytics(
    accessToken,
    property,
    startDate,
    endDate,
    () => countAttempt(counters, run),
    () => { counters.retries += 1; },
    getSyncGscRequestTimeoutMs(),
  );
  return new Map(rows.map((row) => [normalizeForGscMatch(row.pageUrl), row]));
}

async function fetchExactPeriod(
  accessToken: string,
  run: RefreshRun,
  property: string,
  url: string,
  startDate: string,
  endDate: string,
  counters: CallCounters,
  limiter: ReturnType<typeof createLimiter>,
): Promise<SearchAnalyticsRow | null> {
  return limiter.run(() => withRetry(
    () => queryUrlSearchAnalytics(accessToken, property, url, startDate, endDate, getSyncGscRequestTimeoutMs()),
    {
      attempts: getSyncGscRetryAttempts(),
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
      onAttempt: () => countAttempt(counters, run),
      onRetry: () => { counters.retries += 1; },
    },
  ));
}

async function processInternalItem(run: RefreshRun, urls: ContentUrl[]): Promise<UpsertPerformanceCacheInput[]> {
  return urls.map((url) => {
    if (!isEligible(url, run.end_date)) return cacheInput(run, url, computeGrowth(null, null, false));
    return cacheInput(
      run,
      url,
      { ...computeGrowth(null, null, true), dataStatus: "error" },
      `No Search Console property mapped for project "${url.project}". Set it in Admin -> Settings.`,
    );
  });
}

async function processWideItem(
  accessToken: string,
  run: RefreshRun,
  item: RefreshRunItem,
  urls: ContentUrl[],
  counters: CallCounters,
): Promise<UpsertPerformanceCacheInput[]> {
  const property = item.gsc_property;
  if (!property) throw new Error("Wide refresh item has no Search Console property");
  const eligible = urls.filter((url) => isEligible(url, run.end_date));
  const inputs = urls.filter((url) => !isEligible(url, run.end_date)).map((url) => cacheInput(run, url, computeGrowth(null, null, false)));
  const current = await fetchWidePeriod(accessToken, run, property, run.start_date, run.end_date, counters);
  if (run.previous_start_date && run.previous_end_date) await setRefreshPhase(run.id, "fetching_previous");
  const previous = run.previous_start_date && run.previous_end_date
    ? await fetchWidePeriod(accessToken, run, property, run.previous_start_date, run.previous_end_date, counters)
    : new Map<string, PeriodMetrics>();
  for (const url of eligible) {
    const key = normalizeForGscMatch(url.url);
    inputs.push(cacheInput(run, url, computeGrowth(current.get(key) ?? null, previous.get(key) ?? null, true)));
  }
  return inputs;
}

async function processExactItem(
  accessToken: string,
  run: RefreshRun,
  item: RefreshRunItem,
  urls: ContentUrl[],
  counters: CallCounters,
): Promise<UpsertPerformanceCacheInput[]> {
  const property = item.gsc_property;
  if (!property) throw new Error("Exact refresh item has no Search Console property");
  const limiter = createLimiter(getSyncGscConcurrency());
  return Promise.all(urls.map(async (url) => {
    if (!isEligible(url, run.end_date)) return cacheInput(run, url, computeGrowth(null, null, false));
    try {
      const current = await fetchExactPeriod(accessToken, run, property, url.url, run.start_date, run.end_date, counters, limiter);
      const previous = run.previous_start_date && run.previous_end_date
        ? await fetchExactPeriod(accessToken, run, property, url.url, run.previous_start_date, run.previous_end_date, counters, limiter)
        : null;
      return cacheInput(run, url, computeGrowth(current, previous, true));
    } catch (error) {
      if (classifyGoogleApiError(error) === "invalid_credentials") throw error;
      return errorInputs(run, [url], apiError(error, property))[0];
    }
  }));
}

function exactChunks(ids: string[]): string[][] {
  const chunks: string[][] = [];
  const size = getSyncGscExactChunkSize();
  for (let offset = 0; offset < ids.length; offset += size) chunks.push(ids.slice(offset, offset + size));
  return chunks;
}

export interface RefreshProcessResult {
  run: RefreshRun;
  done: boolean;
  processedItem: boolean;
}

export async function processNextRefreshItem(accessToken: string, refreshRunId: string): Promise<RefreshProcessResult> {
  const claimed = await claimNextRefreshItem(refreshRunId);
  if (!claimed) {
    const current = await getRefreshRun(refreshRunId);
    if (!current) throw new Error("refresh_run not found");
    if (current.status === "queued" && current.total_items === 0) {
      await finishRefreshRun(current.id, "success");
      const empty = (await getRefreshRun(refreshRunId)) ?? current;
      return { run: empty, done: true, processedItem: false };
    }
    if (current.status === "running" && current.completed_items >= current.total_items) await publishRefreshRun(current);
    const run = (await getRefreshRun(refreshRunId)) ?? current;
    return { run, done: !["queued", "running"].includes(run.status), processedItem: false };
  }

  const { run, item, leaseOwner } = claimed;
  const stopHeartbeat = startHeartbeat(run.id, item.id, leaseOwner);
  const counters: CallCounters = { apiCalls: 0, retries: 0 };
  const gscStarted = Date.now();
  try {
    const urls = await listContentUrlsByIds(item.content_url_ids);
    const foundIds = new Set(urls.map((url) => url.id));
    const missingIds = item.content_url_ids.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) throw new Error(`Refresh snapshot lost ${missingIds.length} content URL(s)`);
    let inputs: UpsertPerformanceCacheInput[];
    try {
      if (item.item_type === "internal") inputs = await processInternalItem(run, urls);
      else if (item.item_type === "property_exact" || !isSyncGscWideQueryEnabled()) {
        if (run.previous_start_date && run.previous_end_date) await setRefreshPhase(run.id, "fetching_previous");
        inputs = await processExactItem(accessToken, run, item, urls, counters);
      } else {
        inputs = await processWideItem(accessToken, run, item, urls, counters);
      }
    } catch (error) {
      if (item.item_type === "property_wide" && isWideQueryUnsupported(error)) {
        await splitRefreshItemForExactFallback(run.id, item.id, leaseOwner, exactChunks(item.content_url_ids), {
          apiCalls: counters.apiCalls,
          retries: counters.retries,
          gscQueryMs: Date.now() - gscStarted,
          errorType: classifyGoogleApiError(error),
          errorMessage: apiError(error, item.gsc_property ?? "unknown"),
        });
        const updated = (await getRefreshRun(run.id)) ?? run;
        return { run: updated, done: false, processedItem: true };
      }
      const kind = classifyGoogleApiError(error);
      if (kind === "invalid_credentials") throw error;
      if ((kind === "rate_limited" || kind === "transient") && item.attempt_count < 3) {
        await deferRefreshItem(run.id, item.id, leaseOwner, {
          apiCalls: counters.apiCalls,
          retries: counters.retries,
          gscQueryMs: Date.now() - gscStarted,
          errorType: kind,
          errorMessage: apiError(error, item.gsc_property ?? "unknown"),
          delaySeconds: 2 ** item.attempt_count * 5,
        });
        const deferred = (await getRefreshRun(run.id)) ?? run;
        return { run: deferred, done: false, processedItem: true };
      }
      inputs = errorInputs(run, urls, apiError(error, item.gsc_property ?? "unknown"));
    }

    const outcomes = countOutcomes(inputs);
    const dbStarted = Date.now();
    await withTransaction(async (client) => {
      await bulkStagePerformanceCache(run.id, inputs, client);
      await completeRefreshItem(run.id, item.id, leaseOwner, {
        contentUrlIds: item.content_url_ids,
        processed: item.content_url_ids.length,
        withData: outcomes.withData,
        noData: outcomes.noData,
        failed: outcomes.failed,
        apiCalls: counters.apiCalls,
        retries: counters.retries,
        gscQueryMs: Date.now() - gscStarted,
        dbWriteMs: Date.now() - dbStarted,
        errorType: outcomes.failed > 0 ? "url_errors" : undefined,
        errorMessage: outcomes.failed > 0 ? `${outcomes.failed} URL(s) could not be measured` : undefined,
      }, client);
    });
    let updated = (await getRefreshRun(run.id)) ?? run;
    if (updated.completed_items >= updated.total_items) {
      await publishRefreshRun(updated);
      updated = (await getRefreshRun(run.id)) ?? updated;
    }
    return { run: updated, done: !["queued", "running"].includes(updated.status), processedItem: true };
  } catch (error) {
    await finishRefreshRun(run.id, "failed", (error as Error).message).catch(() => undefined);
    throw error;
  } finally {
    stopHeartbeat();
  }
}

async function publishRefreshRun(run: RefreshRun): Promise<void> {
  await withTransaction(async (client) => {
    const lockedResult = await client.query<RefreshRun>("select * from public.refresh_runs where id = $1 for update", [run.id]);
    const locked = lockedResult.rows[0];
    if (!locked || locked.status !== "running" || locked.completed_items < locked.total_items) return;
    const staged = await getStagedPerformanceCount(run.id, client);
    if (staged !== locked.total_urls) throw new Error(`Refresh snapshot incomplete: staged ${staged} of ${locked.total_urls} URLs`);
    await setRefreshPhase(run.id, "publishing", client);
    await publishStagedPerformanceCache(run.id, client);
    await setRefreshPhase(run.id, "rollup", client);
    await computeAndStoreRollups(locked.range_key as RangeKey, locked.start_date, locked.end_date, client);
    if (isRollingRange(locked.range_key as RangeKey)) {
      await setRefreshPhase(run.id, "scoring", client);
      await computeAndStoreScores(locked.range_key as RangeKey, locked.start_date, locked.end_date, client);
      // Warnings are stamped to a closed month, so running this on every refresh
      // re-states the current month's findings rather than piling up new ones.
      // Skipped entirely before the first month has closed.
      if (closedCalendarMonths(1).length > 0) {
        await setRefreshPhase(run.id, "warning", client);
        await evaluateWarningsForClosedMonth({ actorId: "refresh", db: client });
      }
    }
    await finishRefreshRun(
      run.id,
      locked.failed_urls > 0 ? "partial" : "success",
      locked.failed_urls > 0 ? `${locked.failed_urls} URL(s) were published with errors` : undefined,
      client,
    );
  });
}

export async function computeAndStoreRollups(rangeKey: RangeKey, startDate: string, endDate: string, db?: DbExecutor): Promise<void> {
  const rows = await getPerformanceRowsForRange(rangeKey, db);
  const index = attributionIndex(await getUrlAttributionForRange(startDate, endDate, db));
  const { byMember, memberEmails, byProject } = groupByMemberAndProject(rows, index, (row) => row);
  for (const [memberName, memberRows] of byMember) {
    await upsertMemberRollup(
      memberEmails.get(memberName) ?? null,
      { key: memberName, rangeKey, startDate, endDate, ...summarize(memberRows) },
      db,
    );
  }
  for (const [project, projectRows] of byProject) {
    await upsertProjectRollup({ key: project, rangeKey, startDate, endDate, ...summarize(projectRows) }, db);
  }
}

interface UrlBaseline {
  clicks: number | null;
  impressions: number | null;
  sampleCount: number;
}

/**
 * What each URL's current period should be graded against, in place of whatever
 * the single window before it happened to be.
 *
 * A window only yields a sample when every calendar month in it is present, is
 * "ok", and is not flagged as anomalous — a partial sum would read as a drop the
 * URL never had, which is the same class of mistake this whole mechanism exists
 * to stop. Falls back to an empty map when no history is stored yet, leaving the
 * legacy previous-period behaviour untouched.
 */
async function baselineIndex(
  rangeKey: RangeKey,
  startDate: string,
  contentUrlIds: string[],
  db?: DbExecutor,
): Promise<Map<string, UrlBaseline>> {
  const settings = await getBaselineSettings(db);
  const windows = baselineWindows(rangeKey, startDate, settings.lookbackPeriods);
  if (windows.length === 0 || contentUrlIds.length === 0) return new Map();

  const oldest = windows[windows.length - 1].startDate;
  const monthsBack = Math.round((Date.parse(`${startDate}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 86_400_000 / 28) + 1;
  const history = await getMonthlyHistoryForUrls(contentUrlIds, startDate, monthsBack, db);

  const index = new Map<string, UrlBaseline>();
  for (const [contentUrlId, rows] of history) {
    const usable = new Map(rows.filter(isBaselineEligible).map((row) => [row.period_start, row]));
    const clickSamples: Array<number | null> = [];
    const impressionSamples: Array<number | null> = [];
    for (const window of windows) {
      const months = monthStartsIn(window.startDate, window.months).map((month) => usable.get(month));
      if (months.some((month) => !month)) continue;
      clickSamples.push(months.reduce((sum, month) => sum + Number(month!.clicks ?? 0), 0));
      impressionSamples.push(months.reduce((sum, month) => sum + Number(month!.impressions ?? 0), 0));
    }
    if (clickSamples.length === 0) continue;
    index.set(contentUrlId, {
      clicks: robustBaseline(clickSamples, settings.winsorizeMultiple),
      impressions: robustBaseline(impressionSamples, settings.winsorizeMultiple),
      sampleCount: clickSamples.length,
    });
  }
  return index;
}

function monthStartsIn(startMonth: string, months: number): string[] {
  const start = new Date(`${startMonth}T00:00:00.000Z`);
  return Array.from({ length: months }, (_, offset) =>
    new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 1)).toISOString().slice(0, 10));
}

export async function computeAndStoreScores(rangeKey: RangeKey, startDate: string, endDate: string, db?: DbExecutor): Promise<void> {
  const settings = await getKpiSettings(db);
  const rows = await getScoringInputRowsForRange(rangeKey, db);
  const baselines = await baselineIndex(rangeKey, startDate, rows.map((row) => row.content_url_id), db);
  const scored = rows.map((row) => {
    const baseline = baselines.get(row.content_url_id);
    return {
      row,
      sampleCount: baseline?.sampleCount ?? 0,
      result: computeUrlScore({
        projectType: row.project_type,
        dataStatus: row.data_status,
        kpiExcluded: row.kpi_excluded,
        currentClicks: row.current_clicks,
        previousClicks: row.previous_clicks,
        currentImpressions: row.current_impressions,
        previousImpressions: row.previous_impressions,
        baselineClicks: baseline?.clicks ?? null,
        baselineImpressions: baseline?.impressions ?? null,
      }, settings),
    };
  });
  await bulkUpsertUrlPerformanceScores(scored.map(({ row, result, sampleCount }) => ({
    contentUrlId: row.content_url_id,
    rangeKey,
    startDate,
    endDate,
    projectType: row.project_type,
    baselineSampleCount: sampleCount,
    result,
  })), db);
  const index = attributionIndex(await getUrlAttributionForRange(startDate, endDate, db));
  const { byMember, memberEmails, byProject } = groupByMemberAndProject(scored, index, (item) => item.row);
  for (const [memberName, items] of byMember) {
    // The direction is taken from the very rows this run just scored, not from
    // member_performance_rollup: that table is written by a different function,
    // and the recompute endpoint does not run it at all — reading it back would
    // let a member be adjusted on a percentage from an older snapshot.
    const totals = periodTotals(items.map(({ row }) => ({
      dataStatus: row.data_status,
      clicks: row.current_clicks,
      impressions: row.current_impressions,
      previousClicks: row.previous_clicks,
      previousImpressions: row.previous_impressions,
    })));
    await upsertMemberScore(
      memberEmails.get(memberName) ?? null,
      {
        key: memberName,
        rangeKey,
        startDate,
        endDate,
        ...aggregateMemberScore(
          items.map((item) => item.result),
          settings,
          { clickGrowthPct: totals.clickGrowthPct, impressionGrowthPct: totals.impressionGrowthPct },
          OPPOSITE_SIGN_FACTOR,
        ),
      },
      db,
    );
  }
  for (const [project, items] of byProject) {
    await upsertProjectScore(
      { key: project, rangeKey, startDate, endDate, ...aggregateScore(items.map((item) => item.result), settings.urlWeightCapPct) },
      db,
    );
  }
}

/**
 * One rollup row's worth of numbers.
 *
 * The click/impression totals and their growth percentages come from the shared
 * periodTotals helper rather than being summed here, so the percentage this
 * table stores and the percentage the member score reads the sign of are the
 * same arithmetic over the same rows. What stays local is what only a rollup
 * has: CTR, average position, and the growth_status tallies.
 */
function summarize(rows: Array<{
  clicks: number | null; impressions: number | null; ctr: number | null; position: number | null;
  previous_clicks: number | null; previous_impressions: number | null; growth_status: string; data_status: string;
}>) {
  const okRows = rows.filter((row) => row.data_status === "ok");
  const totals = periodTotals(rows.map((row) => ({
    dataStatus: row.data_status,
    clicks: row.clicks,
    impressions: row.impressions,
    previousClicks: row.previous_clicks,
    previousImpressions: row.previous_impressions,
  })));
  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const positionRows = okRows.filter((row) => row.position !== null);
  const position = positionRows.length ? positionRows.reduce((sum, row) => sum + Number(row.position ?? 0), 0) / positionRows.length : null;
  return {
    urlCount: rows.length,
    urlsWithData: okRows.length,
    growingUrls: rows.filter((row) => row.growth_status === "growing" || row.growth_status === "new_signal").length,
    stableUrls: rows.filter((row) => row.growth_status === "stable").length,
    decliningUrls: rows.filter((row) => row.growth_status === "declining").length,
    noDataUrls: rows.filter((row) => row.data_status !== "ok").length,
    clicks: totals.clicks,
    impressions: totals.impressions,
    ctr,
    position,
    previousClicks: totals.previousClicks,
    previousImpressions: totals.previousImpressions,
    clickDelta: totals.clickDelta,
    clickGrowthPct: totals.clickGrowthPct,
    impressionDelta: totals.impressionDelta,
    impressionGrowthPct: totals.impressionGrowthPct,
  };
}
