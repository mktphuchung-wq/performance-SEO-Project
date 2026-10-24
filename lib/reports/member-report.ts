import { createLimiter, withRetry } from "@/lib/concurrency";
import { getSyncGscConcurrency, getSyncGscRequestTimeoutMs, getSyncGscRetryAttempts } from "@/lib/env";
import { queryUrlSearchAnalytics } from "@/lib/google";
import { computeGrowth, type DataStatus, type GrowthStatus, type PeriodMetrics } from "@/lib/performance/growth";
import { summarizePerformanceRows } from "@/lib/performance/refresh";
import { periodTotals } from "@/lib/performance/period-totals";
import {
  OPPOSITE_SIGN_FACTOR,
  aggregateMemberScore,
  computeUrlScore,
  robustBaseline,
  type UrlScoreResult,
} from "@/lib/performance/score";
import { baselineWindows, closedCalendarMonths, computeRangeDatesAtCutoff } from "@/lib/ranges";
import {
  getMemberAliasMap,
  MemberIdentityAmbiguityError,
  resolveMemberNameForReport,
} from "@/lib/repositories/member-aliases";
import {
  getHistoricalReportUrlAttributionForRange,
  type UrlAttributionRow,
} from "@/lib/repositories/content-url-works";
import { getMonthlyHistoryForUrls, isBaselineEligible, type MonthlyMetricRow } from "@/lib/repositories/content-url-monthly-metrics";
import {
  getCompleteMemberReportSnapshotForMember,
  MEMBER_REPORT_RANGE_KEYS,
  publishMemberReportSnapshot,
  type CompleteMemberReportSnapshot,
  type MemberReportRangeKey,
  type MemberReportSummarySnapshotInput,
  type MemberReportUrlSnapshotInput,
} from "@/lib/repositories/member-report-snapshots";
import type { UrlPerformanceRow } from "@/lib/repositories/performance-cache";
import { getBaselineSettings, getKpiSettings } from "@/lib/repositories/kpi-settings";
import { listContentUrlsByIds, type ContentUrl } from "@/lib/repositories/content-urls";
import { gscPropertyCoversUrl, listProjectGscProperties } from "@/lib/repositories/project-gsc-properties";

export type MemberReportErrorCode =
  | "INVALID_REPORT_MONTH"
  | "INCOMPLETE_REPORT_MONTH"
  | "MEMBER_NOT_FOUND"
  | "MEMBER_IDENTITY_AMBIGUOUS"
  | "HISTORICAL_GSC_UNAVAILABLE";

export class MemberReportError extends Error {
  constructor(
    public readonly code: MemberReportErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MemberReportError";
  }
}

export interface GenerateMemberReportInput {
  accessToken: string;
  reportMonth: string;
  memberName?: string | null;
  memberEmail?: string | null;
}

export interface MemberReportRangeWindow {
  rangeKey: MemberReportRangeKey;
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
}

export interface MemberReportReadDto {
  id: string;
  reportMonth: string;
  member: { name: string; email: string | null };
  completedAt: string | null;
  createdAt: string;
  summaries: Array<{
    rangeKey: MemberReportRangeKey;
    startDate: string;
    endDate: string;
    previousStartDate: string;
    previousEndDate: string;
    urlCount: number;
    urlsWithData: number;
    growingUrls: number;
    stableUrls: number;
    decliningUrls: number;
    noDataUrls: number;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number | null;
    previousClicks: number | null;
    previousImpressions: number | null;
    clickDelta: number | null;
    clickGrowthPct: number | null;
    impressionDelta: number | null;
    impressionGrowthPct: number | null;
    kpiScore: number | null;
    eligibleUrlCount: number;
    excludedUrlCount: number;
    noDataUrlCount: number;
    cappedUrlCount: number;
    totalWeight: number;
    baseKpiScore: number | null;
    clickComponentScore: number | null;
    impressionComponentScore: number | null;
    effectiveClickWeight: number | null;
    effectiveImpressionWeight: number | null;
    directionAdjustment: string;
    oppositeSignFactor: number | null;
    formulaVersion: string;
  }>;
  urls: Array<{
    contentUrlId: string;
    rangeKey: MemberReportRangeKey;
    urlHash: string;
    contentHash: string | null;
    project: string;
    url: string;
    memberName: string;
    memberEmail: string | null;
    workType: string;
    gscProperty: string | null;
    isActive: boolean;
    workedAt: string | null;
    firstWorkedAt: string | null;
    publishedAt: string | null;
    kpiExcluded: boolean;
    kpiExcludedReason: string | null;
    startDate: string;
    endDate: string;
    previousStartDate: string;
    previousEndDate: string;
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    position: number | null;
    previousClicks: number | null;
    previousImpressions: number | null;
    previousCtr: number | null;
    previousPosition: number | null;
    clickDelta: number | null;
    clickGrowthPct: number | null;
    impressionDelta: number | null;
    impressionGrowthPct: number | null;
    growthStatus: GrowthStatus;
    dataStatus: DataStatus;
    errorMessage: string | null;
    scoreState: UrlScoreResult["state"];
    kpiScore: number | null;
    weight: number;
  }>;
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

export function memberReportRangeWindows(reportMonth: string): MemberReportRangeWindow[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(reportMonth)) {
    throw new MemberReportError("INVALID_REPORT_MONTH", "reportMonth must be YYYY-MM", { reportMonth });
  }
  const latestClosedMonth = closedCalendarMonths(1)[0];
  if (!latestClosedMonth || monthEnd(reportMonth) > latestClosedMonth.endDate) {
    throw new MemberReportError(
      "INCOMPLETE_REPORT_MONTH",
      "Report month must be fully available after the Search Console data lag",
      { reportMonth, latestAvailableMonth: latestClosedMonth?.startDate.slice(0, 7) ?? null },
    );
  }
  const cutoff = monthEnd(reportMonth);
  return MEMBER_REPORT_RANGE_KEYS.map((rangeKey) => {
    const range = computeRangeDatesAtCutoff(rangeKey, cutoff);
    return {
      rangeKey,
      startDate: range.startDate,
      endDate: range.endDate,
      previousStartDate: range.previousStartDate!,
      previousEndDate: range.previousEndDate!,
    };
  });
}

function monthStartsIn(startMonth: string, months: number): string[] {
  const start = new Date(`${startMonth}T00:00:00.000Z`);
  return Array.from({ length: months }, (_, offset) =>
    new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 1)).toISOString().slice(0, 10));
}

function baselineFor(
  range: MemberReportRangeWindow,
  history: MonthlyMetricRow[],
  lookbackPeriods: number,
  winsorizeMultiple: number,
): { clicks: number | null; impressions: number | null } {
  const windows = baselineWindows(range.rangeKey, range.startDate, lookbackPeriods);
  const usable = new Map(history.filter(isBaselineEligible).map((row) => [row.period_start, row]));
  const clicks: Array<number | null> = [];
  const impressions: Array<number | null> = [];
  for (const window of windows) {
    const months = monthStartsIn(window.startDate, window.months).map((month) => usable.get(month));
    if (months.some((month) => !month)) continue;
    clicks.push(months.reduce((sum, month) => sum + Number(month!.clicks ?? 0), 0));
    impressions.push(months.reduce((sum, month) => sum + Number(month!.impressions ?? 0), 0));
  }
  return {
    clicks: robustBaseline(clicks, winsorizeMultiple),
    impressions: robustBaseline(impressions, winsorizeMultiple),
  };
}

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

export function matchesRequestedAttribution(
  owner: Pick<UrlAttributionRow, "member_name" | "member_email">,
  email: string | null,
  memberName: string,
  aliases: ReadonlyMap<string, string>,
): boolean {
  const requestedName = normalizeIdentity(memberName);
  const ownerName = normalizeIdentity(owner.member_name);
  if (!requestedName || ownerName !== requestedName) return false;
  if (!email) return true;
  const canonicalEmail = [...aliases].find(([name]) => normalizeIdentity(name) === ownerName)?.[1];
  if (canonicalEmail) return normalizeIdentity(canonicalEmail) === normalizeIdentity(email);
  return !owner.member_email || normalizeIdentity(owner.member_email) === normalizeIdentity(email);
}

function eligible(url: ContentUrl, endDate: string): boolean {
  return !url.published_at || url.published_at <= endDate;
}

async function fetchMetrics(
  accessToken: string,
  url: ContentUrl,
  startDate: string,
  endDate: string,
  limiter: ReturnType<typeof createLimiter>,
): Promise<PeriodMetrics | null> {
  if (!url.gsc_property) throw new Error(`No Search Console property is configured for ${url.project}`);
  if (!gscPropertyCoversUrl(url.gsc_property, url.url)) {
    throw new Error(`Search Console property ${url.gsc_property} does not cover ${url.url}`);
  }
  return limiter.run(() => withRetry(
    () => queryUrlSearchAnalytics(accessToken, url.gsc_property!, url.url, startDate, endDate, getSyncGscRequestTimeoutMs()),
    { attempts: getSyncGscRetryAttempts(), baseDelayMs: 1_000, maxDelayMs: 30_000 },
  ));
}

function performanceRow(
  range: MemberReportRangeWindow,
  url: ContentUrl,
  growth: ReturnType<typeof computeGrowth>,
  errorMessage: string | null,
): UrlPerformanceRow {
  return {
    id: url.id,
    content_url_id: url.id,
    range_key: range.rangeKey,
    start_date: range.startDate,
    end_date: range.endDate,
    previous_start_date: range.previousStartDate,
    previous_end_date: range.previousEndDate,
    clicks: growth.clicks,
    impressions: growth.impressions,
    ctr: growth.ctr,
    position: growth.position,
    previous_clicks: growth.previousClicks,
    previous_impressions: growth.previousImpressions,
    previous_ctr: growth.previousCtr,
    previous_position: growth.previousPosition,
    click_delta: growth.clickDelta,
    click_growth_pct: growth.clickGrowthPct,
    impression_delta: growth.impressionDelta,
    impression_growth_pct: growth.impressionGrowthPct,
    growth_status: growth.growthStatus,
    data_status: growth.dataStatus,
    error_message: errorMessage,
    refreshed_at: new Date().toISOString(),
    project: url.project,
    url: url.url,
    member_name: url.member_name,
    member_email: url.member_email,
    work_type: url.work_type,
    first_worked_at: url.first_worked_at,
    worked_at: url.worked_at,
    published_at: url.published_at,
    period_work_count: null,
    kpi_excluded: url.kpi_excluded,
    kpi_excluded_reason: url.kpi_excluded_reason,
  };
}

function buildSummary(
  range: MemberReportRangeWindow,
  rows: UrlPerformanceRow[],
  scores: UrlScoreResult[],
  settings: Awaited<ReturnType<typeof getKpiSettings>>,
): MemberReportSummarySnapshotInput {
  const rollup = summarizePerformanceRows(rows);
  const totals = periodTotals(rows.map((row) => ({
    dataStatus: row.data_status,
    clicks: row.clicks,
    impressions: row.impressions,
    previousClicks: row.previous_clicks,
    previousImpressions: row.previous_impressions,
  })));
  const score = aggregateMemberScore(
    scores,
    settings,
    { clickGrowthPct: totals.clickGrowthPct, impressionGrowthPct: totals.impressionGrowthPct },
    OPPOSITE_SIGN_FACTOR,
  );
  return {
    range_key: range.rangeKey,
    start_date: range.startDate,
    end_date: range.endDate,
    previous_start_date: range.previousStartDate,
    previous_end_date: range.previousEndDate,
    url_count: rollup.urlCount,
    urls_with_data: rollup.urlsWithData,
    growing_urls: rollup.growingUrls,
    stable_urls: rollup.stableUrls,
    declining_urls: rollup.decliningUrls,
    no_data_urls: rollup.noDataUrls,
    clicks: rollup.clicks,
    impressions: rollup.impressions,
    ctr: rollup.ctr,
    position: rollup.position,
    previous_clicks: rollup.previousClicks,
    previous_impressions: rollup.previousImpressions,
    click_delta: rollup.clickDelta,
    click_growth_pct: rollup.clickGrowthPct,
    impression_delta: rollup.impressionDelta,
    impression_growth_pct: rollup.impressionGrowthPct,
    kpi_score: score.kpiScore,
    eligible_url_count: score.eligibleUrlCount,
    excluded_url_count: score.excludedUrlCount,
    no_data_url_count: score.noDataUrlCount,
    capped_url_count: score.cappedUrlCount,
    total_weight: score.totalWeight,
    base_kpi_score: score.baseKpiScore,
    click_component_score: score.clickComponentScore,
    impression_component_score: score.impressionComponentScore,
    effective_click_weight: score.effectiveClickWeight,
    effective_impression_weight: score.effectiveImpressionWeight,
    direction_adjustment: score.directionAdjustment,
    opposite_sign_factor: score.oppositeSignFactor,
    formula_version: score.formulaVersion,
  };
}

function buildUrlSnapshot(
  range: MemberReportRangeWindow,
  row: UrlPerformanceRow,
  url: ContentUrl,
  memberName: string,
  memberEmail: string | null,
  score: UrlScoreResult,
  attribution: UrlAttributionRow,
): MemberReportUrlSnapshotInput {
  return {
    content_url_id: row.content_url_id,
    range_key: range.rangeKey,
    url_hash: url.url_hash,
    content_hash: url.content_hash,
    project: url.project,
    url: url.url,
    member_name: memberName,
    member_email: memberEmail,
    work_type: attribution.work_type,
    gsc_property: url.gsc_property,
    is_active: url.is_active,
    worked_at: attribution.worked_at,
    first_worked_at: url.first_worked_at,
    published_at: url.published_at,
    kpi_excluded: url.kpi_excluded,
    kpi_excluded_reason: url.kpi_excluded_reason,
    start_date: range.startDate,
    end_date: range.endDate,
    previous_start_date: range.previousStartDate,
    previous_end_date: range.previousEndDate,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
    previous_clicks: row.previous_clicks,
    previous_impressions: row.previous_impressions,
    previous_ctr: row.previous_ctr,
    previous_position: row.previous_position,
    click_delta: row.click_delta,
    click_growth_pct: row.click_growth_pct,
    impression_delta: row.impression_delta,
    impression_growth_pct: row.impression_growth_pct,
    growth_status: row.growth_status as MemberReportUrlSnapshotInput["growth_status"],
    data_status: row.data_status as MemberReportUrlSnapshotInput["data_status"],
    error_message: row.error_message,
    score_state: score.state,
    kpi_score: score.score,
    weight: score.weight,
  };
}

export async function generateMemberReport(
  input: GenerateMemberReportInput,
): Promise<{ snapshot: CompleteMemberReportSnapshot; created: boolean }> {
  const ranges = memberReportRangeWindows(input.reportMonth);
  const email = input.memberEmail?.trim().toLowerCase() || null;
  let memberName = input.memberName?.trim() || null;
  if (!memberName && email) {
    try {
      memberName = await resolveMemberNameForReport(email);
    } catch (error) {
      if (error instanceof MemberIdentityAmbiguityError) {
        throw new MemberReportError(
          "MEMBER_IDENTITY_AMBIGUOUS",
          "The selected email maps to multiple canonical members",
          { memberEmail: email, memberNames: error.memberNames },
        );
      }
      throw error;
    }
  }
  if (!memberName) {
    throw new MemberReportError("MEMBER_NOT_FOUND", "A member name or mapped email is required", { memberEmail: email });
  }
  const existing = await getCompleteMemberReportSnapshotForMember(
    { memberName, memberEmail: email },
    input.reportMonth,
  );
  if (existing) return { snapshot: existing, created: false };

  const [settings, baselineSettings, projectSettings, aliases, attributions] = await Promise.all([
    getKpiSettings(),
    getBaselineSettings(),
    listProjectGscProperties(),
    getMemberAliasMap(),
    Promise.all(ranges.map((range) =>
      getHistoricalReportUrlAttributionForRange(range.startDate, range.endDate))),
  ]);
  const projectIndex = new Map(projectSettings.map((row) => [row.project, row]));
  const requestedAttributions = attributions.map((rows) =>
    rows.filter((owner) => matchesRequestedAttribution(owner, email, memberName, aliases)));
  const attributedIds = requestedAttributions.map((rows) => new Set(rows.map((owner) => owner.content_url_id)));
  const unionIds = new Set(attributedIds.flatMap((ids) => [...ids]));
  const reportUrls = (await listContentUrlsByIds([...unionIds])).sort((a, b) =>
    a.project.localeCompare(b.project) || a.url.localeCompare(b.url) || a.id.localeCompare(b.id));
  const oldest = baselineWindows("last_6_months", ranges[2].startDate, baselineSettings.lookbackPeriods).at(-1)?.startDate
    ?? ranges[2].previousStartDate;
  const monthsBack = Math.max(1, Math.ceil(
    (Date.parse(`${ranges[0].startDate}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 2_419_200_000,
  ));
  const history = await getMonthlyHistoryForUrls(reportUrls.map((url) => url.id), ranges[0].startDate, monthsBack);
  const limiter = createLimiter(getSyncGscConcurrency());
  const rowsByRange: UrlPerformanceRow[][] = ranges.map(() => []);
  const scoresByRange: UrlScoreResult[][] = ranges.map(() => []);
  const urls: MemberReportUrlSnapshotInput[] = [];

  const computed = await Promise.all(reportUrls.flatMap((url) => ranges.map(async (range, index) => {
      const project = projectIndex.get(url.project);
      let growth = computeGrowth(null, null, eligible(url, range.endDate));
      const errorMessage: string | null = null;
      if (eligible(url, range.endDate)) {
        if (!project) {
          throw new MemberReportError(
            "HISTORICAL_GSC_UNAVAILABLE",
            `No Search Console property is configured for ${url.project}`,
            { project: url.project, contentUrlId: url.id },
          );
        }
        try {
          const measuredUrl = { ...url, gsc_property: project.gsc_property };
          const [current, previous] = await Promise.all([
            fetchMetrics(input.accessToken, measuredUrl, range.startDate, range.endDate, limiter),
            fetchMetrics(input.accessToken, measuredUrl, range.previousStartDate, range.previousEndDate, limiter),
          ]);
          growth = computeGrowth(current, previous, true);
        } catch (error) {
          throw new MemberReportError(
            "HISTORICAL_GSC_UNAVAILABLE",
            error instanceof Error ? error.message : "Search Console query failed",
            { rangeKey: range.rangeKey, contentUrlId: url.id },
          );
        }
      }
      const baseline = baselineFor(
        range,
        history.get(url.id) ?? [],
        baselineSettings.lookbackPeriods,
        baselineSettings.winsorizeMultiple,
      );
      const score = computeUrlScore({
        projectType: project?.project_type ?? "growth",
        dataStatus: growth.dataStatus,
        kpiExcluded: url.kpi_excluded,
        currentClicks: growth.clicks,
        previousClicks: growth.previousClicks,
        currentImpressions: growth.impressions,
        previousImpressions: growth.previousImpressions,
        baselineClicks: baseline.clicks,
        baselineImpressions: baseline.impressions,
      }, settings);
      const row = performanceRow(range, url, growth, errorMessage);
      const attribution = requestedAttributions[index].find((owner) => owner.content_url_id === url.id);
      return attribution
        ? {
            index,
            row,
            score,
            snapshot: buildUrlSnapshot(
              range,
              row,
              { ...url, gsc_property: project?.gsc_property ?? null },
              memberName,
              email,
              score,
              attribution,
            ),
          }
        : null;
    })));

  for (const result of computed) {
    if (!result) continue;
    rowsByRange[result.index].push(result.row);
    scoresByRange[result.index].push(result.score);
    urls.push(result.snapshot);
  }

  return publishMemberReportSnapshot({
    reportMonth: input.reportMonth,
    memberName,
    memberEmail: email,
    summaries: ranges.map((range, index) => buildSummary(range, rowsByRange[index], scoresByRange[index], settings)),
    urls,
  });
}

export function toMemberReportReadDto(snapshot: CompleteMemberReportSnapshot): MemberReportReadDto {
  return {
    id: snapshot.report.id,
    reportMonth: snapshot.report.report_month.slice(0, 7),
    member: { name: snapshot.report.member_name, email: snapshot.report.member_email },
    completedAt: snapshot.report.completed_at,
    createdAt: snapshot.report.created_at,
    summaries: snapshot.summaries.map((row) => ({
      rangeKey: row.range_key,
      startDate: row.start_date,
      endDate: row.end_date,
      previousStartDate: row.previous_start_date,
      previousEndDate: row.previous_end_date,
      urlCount: row.url_count,
      urlsWithData: row.urls_with_data,
      growingUrls: row.growing_urls,
      stableUrls: row.stable_urls,
      decliningUrls: row.declining_urls,
      noDataUrls: row.no_data_urls,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
      previousClicks: row.previous_clicks,
      previousImpressions: row.previous_impressions,
      clickDelta: row.click_delta,
      clickGrowthPct: row.click_growth_pct,
      impressionDelta: row.impression_delta,
      impressionGrowthPct: row.impression_growth_pct,
      kpiScore: row.kpi_score,
      eligibleUrlCount: row.eligible_url_count,
      excludedUrlCount: row.excluded_url_count,
      noDataUrlCount: row.no_data_url_count,
      cappedUrlCount: row.capped_url_count,
      totalWeight: row.total_weight,
      baseKpiScore: row.base_kpi_score,
      clickComponentScore: row.click_component_score,
      impressionComponentScore: row.impression_component_score,
      effectiveClickWeight: row.effective_click_weight,
      effectiveImpressionWeight: row.effective_impression_weight,
      directionAdjustment: row.direction_adjustment,
      oppositeSignFactor: row.opposite_sign_factor,
      formulaVersion: row.formula_version,
    })),
    urls: snapshot.urls.map((row) => ({
      contentUrlId: row.content_url_id,
      rangeKey: row.range_key,
      urlHash: row.url_hash,
      contentHash: row.content_hash,
      project: row.project,
      url: row.url,
      memberName: row.member_name,
      memberEmail: row.member_email,
      workType: row.work_type,
      gscProperty: row.gsc_property,
      isActive: row.is_active,
      workedAt: row.worked_at,
      firstWorkedAt: row.first_worked_at,
      publishedAt: row.published_at,
      kpiExcluded: row.kpi_excluded,
      kpiExcludedReason: row.kpi_excluded_reason,
      startDate: row.start_date,
      endDate: row.end_date,
      previousStartDate: row.previous_start_date,
      previousEndDate: row.previous_end_date,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
      previousClicks: row.previous_clicks,
      previousImpressions: row.previous_impressions,
      previousCtr: row.previous_ctr,
      previousPosition: row.previous_position,
      clickDelta: row.click_delta,
      clickGrowthPct: row.click_growth_pct,
      impressionDelta: row.impression_delta,
      impressionGrowthPct: row.impression_growth_pct,
      growthStatus: row.growth_status,
      dataStatus: row.data_status,
      errorMessage: row.error_message,
      scoreState: row.score_state,
      kpiScore: row.kpi_score,
      weight: row.weight,
    })),
  };
}
