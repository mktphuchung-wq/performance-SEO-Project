import { createLimiter, withRetry } from "@/lib/concurrency";
import {
  getSyncGscConcurrency,
  getSyncGscRequestTimeoutMs,
  getSyncGscRetryAttempts,
  isSyncGscWideQueryEnabled,
} from "@/lib/env";
import { queryAllPagesSearchAnalytics, queryUrlSearchAnalytics, type SearchAnalyticsRow } from "@/lib/google";
import { isWideQueryUnsupported } from "@/lib/google-errors";
import { detectAnomaly, reconcileAnomaly, median, type AnomalySettings } from "@/lib/performance/anomaly";
import {
  bulkSetAnomalyFlags,
  bulkUpsertMonthlyMetrics,
  getMonthlyHistoryForUrls,
  isBaselineEligible,
  type AnomalyFlagInput,
  type MonthlyMetricRow,
  type UpsertMonthlyMetricInput,
} from "@/lib/repositories/content-url-monthly-metrics";
import { listActiveContentUrls, type ContentUrl } from "@/lib/repositories/content-urls";
import { getBaselineSettings } from "@/lib/repositories/kpi-settings";
import { closedCalendarMonths, type CalendarMonth } from "@/lib/ranges";
import { normalizeForGscMatch } from "@/lib/sync/normalize-url";

/**
 * How much history the detector may look at. Well past any sensible
 * anomaly_min_history_months, and bounded because Search Console only keeps
 * roughly sixteen months anyway.
 */
const DETECTION_LOOKBACK_MONTHS = 18;

export interface MonthlySnapshotResult {
  months: string[];
  urlsMeasured: number;
  rowsWritten: number;
  flagged: number;
  reconciled: number;
  errors: string[];
}

/**
 * Records one closed calendar month per URL, then asks — right there, on ingest —
 * whether that month is so far off the URL's own history that letting it stand as
 * next month's yardstick would misjudge whoever worked on it.
 *
 * This runs apart from the refresh pipeline on purpose. Refresh fills rolling
 * windows that move with the GSC cutoff and get overwritten; this fills fixed
 * calendar buckets that accumulate. Only the second kind can be compared across
 * time, which is what the whole baseline depends on.
 */
export async function runMonthlySnapshot(
  accessToken: string,
  options: { months: number; endingBefore?: string } = { months: 1 },
): Promise<MonthlySnapshotResult> {
  const settings = await getBaselineSettings();
  const urls = (await listActiveContentUrls()).filter((url) => url.gsc_property);
  const months = closedCalendarMonths(options.months, options.endingBefore);
  const result: MonthlySnapshotResult = {
    months: months.map((month) => month.startDate),
    urlsMeasured: urls.length,
    rowsWritten: 0,
    flagged: 0,
    reconciled: 0,
    errors: [],
  };
  if (urls.length === 0 || months.length === 0) return result;

  const byProperty = new Map<string, ContentUrl[]>();
  for (const url of urls) {
    const property = url.gsc_property as string;
    const existing = byProperty.get(property);
    if (existing) existing.push(url);
    else byProperty.set(property, [url]);
  }

  // Oldest first: detection for a month reads the months before it, so they have
  // to be in the table already.
  for (const month of [...months].reverse()) {
    const inputs: UpsertMonthlyMetricInput[] = [];
    for (const [property, propertyUrls] of byProperty) {
      try {
        inputs.push(...(await measureMonth(accessToken, property, propertyUrls, month)));
      } catch (error) {
        result.errors.push(`${property} @ ${month.startDate}: ${(error as Error).message}`);
      }
    }
    if (inputs.length === 0) continue;
    await bulkUpsertMonthlyMetrics(inputs);
    result.rowsWritten += inputs.length;

    const flags = await classifyMonth(inputs.map((input) => input.contentUrlId), month, settings.anomaly);
    await bulkSetAnomalyFlags(flags);
    result.flagged += flags.filter((flag) => flag.status === "provisional").length;
    result.reconciled += flags.filter((flag) => flag.status === "confirmed" || flag.status === "dismissed").length;
  }

  return result;
}

async function measureMonth(
  accessToken: string,
  property: string,
  urls: ContentUrl[],
  month: CalendarMonth,
): Promise<UpsertMonthlyMetricInput[]> {
  const eligible = urls.filter((url) => !url.published_at || url.published_at <= month.endDate);
  const notEligible = urls
    .filter((url) => url.published_at && url.published_at > month.endDate)
    .map((url) => emptyMetric(url.id, month, "not_eligible"));
  if (eligible.length === 0) return notEligible;

  const measured = isSyncGscWideQueryEnabled()
    ? await measureWide(accessToken, property, eligible, month).catch((error) => {
        if (!isWideQueryUnsupported(error)) throw error;
        return null;
      })
    : null;

  return [...notEligible, ...(measured ?? (await measureExact(accessToken, property, eligible, month)))];
}

async function measureWide(
  accessToken: string,
  property: string,
  urls: ContentUrl[],
  month: CalendarMonth,
): Promise<UpsertMonthlyMetricInput[]> {
  const rows = await queryAllPagesSearchAnalytics(
    accessToken,
    property,
    month.startDate,
    month.endDate,
    undefined,
    undefined,
    getSyncGscRequestTimeoutMs(),
  );
  const byUrl = new Map(rows.map((row) => [normalizeForGscMatch(row.pageUrl), row]));
  return urls.map((url) => toMetric(url.id, month, byUrl.get(normalizeForGscMatch(url.url)) ?? null));
}

async function measureExact(
  accessToken: string,
  property: string,
  urls: ContentUrl[],
  month: CalendarMonth,
): Promise<UpsertMonthlyMetricInput[]> {
  const limiter = createLimiter(getSyncGscConcurrency());
  return Promise.all(urls.map((url) => limiter.run(async () => {
    try {
      const row = await withRetry(
        () => queryUrlSearchAnalytics(accessToken, property, url.url, month.startDate, month.endDate, getSyncGscRequestTimeoutMs()),
        { attempts: getSyncGscRetryAttempts(), baseDelayMs: 1_000, maxDelayMs: 30_000 },
      );
      return toMetric(url.id, month, row);
    } catch {
      return emptyMetric(url.id, month, "error");
    }
  })));
}

function toMetric(contentUrlId: string, month: CalendarMonth, row: SearchAnalyticsRow | null): UpsertMonthlyMetricInput {
  if (!row) return emptyMetric(contentUrlId, month, "no_data");
  return {
    contentUrlId,
    periodStart: month.startDate,
    periodEnd: month.endDate,
    clicks: row.clicks,
    impressions: row.impressions,
    dataStatus: "ok",
  };
}

function emptyMetric(contentUrlId: string, month: CalendarMonth, dataStatus: string): UpsertMonthlyMetricInput {
  return {
    contentUrlId,
    periodStart: month.startDate,
    periodEnd: month.endDate,
    clicks: null,
    impressions: null,
    dataStatus,
  };
}

/**
 * Two passes over the month that just landed: flag it if it stands out from its
 * own past, and settle the verdict on the month before it, which now has the one
 * piece of evidence it was missing — what happened next.
 */
async function classifyMonth(
  contentUrlIds: string[],
  month: CalendarMonth,
  settings: AnomalySettings,
): Promise<AnomalyFlagInput[]> {
  const history = await getMonthlyHistoryForUrls(contentUrlIds, month.startDate, DETECTION_LOOKBACK_MONTHS);
  const current = await getMonthlyHistoryForUrls(contentUrlIds, nextMonthStart(month.startDate), 1);
  const flags: AnomalyFlagInput[] = [];

  for (const contentUrlId of contentUrlIds) {
    const thisMonth = current.get(contentUrlId)?.[0];
    if (!thisMonth || thisMonth.data_status !== "ok") continue;
    const past = history.get(contentUrlId) ?? [];

    // Clicks decide. Impressions move for reasons that have nothing to do with a
    // page (an index-wide query shift), and clicks are what the score weights
    // most heavily anyway.
    const trailing = past.filter((row) => row.data_status === "ok").map((row) => Number(row.clicks ?? 0));
    const verdict = detectAnomaly(Number(thisMonth.clicks ?? 0), trailing, settings);
    if (verdict.direction) {
      flags.push({
        contentUrlId,
        periodStart: month.startDate,
        status: "provisional",
        direction: verdict.direction,
        zscore: verdict.zscore,
      });
    }

    const reconciled = reconcilePrevious(past, Number(thisMonth.clicks ?? 0), settings);
    if (reconciled) flags.push(reconciled);
  }
  return flags;
}

function reconcilePrevious(
  past: MonthlyMetricRow[],
  currentClicks: number,
  settings: AnomalySettings,
): AnomalyFlagInput | null {
  // `past` is newest first, so [0] is the month immediately before the one just
  // ingested — the only one this month can be evidence about.
  const previous = past[0];
  if (!previous || previous.anomaly_status !== "provisional") return null;

  const before = past.slice(1).filter(isBaselineEligible).map((row) => Number(row.clicks ?? 0));
  if (before.length === 0) return null;

  const status = reconcileAnomaly(Number(previous.clicks ?? 0), currentClicks, median(before), settings);
  return {
    contentUrlId: previous.content_url_id,
    periodStart: previous.period_start,
    status,
    direction: previous.anomaly_direction,
    zscore: previous.anomaly_zscore,
  };
}

function nextMonthStart(monthStart: string): string {
  const date = new Date(`${monthStart}T00:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}
