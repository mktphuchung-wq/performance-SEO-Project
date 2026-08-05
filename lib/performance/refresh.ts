import { classifyGoogleApiError, queryUrlSearchAnalytics } from "@/lib/google";
import { computeGrowth, type PeriodMetrics } from "@/lib/performance/growth";
import { listContentUrlsByIds, listActiveContentUrls, type ContentUrl } from "@/lib/repositories/content-urls";
import { upsertPerformanceCache } from "@/lib/repositories/performance-cache";
import { advanceRefreshRun, createRefreshRun, finishRefreshRun, getRefreshRun, type RefreshRun } from "@/lib/repositories/refresh-runs";
import { getPerformanceRowsForRange } from "@/lib/repositories/performance-cache";
import { upsertMemberRollup, upsertProjectRollup } from "@/lib/repositories/rollups";
import { computeRangeDates, type RangeKey } from "@/lib/ranges";

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
    await computeAndStoreRollups(run.range_key as RangeKey, run.start_date, run.end_date);
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
  const previousClicks = okRows.reduce((sum, r) => sum + Number(r.previous_clicks ?? 0), 0);
  const previousImpressions = okRows.reduce((sum, r) => sum + Number(r.previous_impressions ?? 0), 0);
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const positionRows = okRows.filter((r) => r.position !== null);
  const position = positionRows.length
    ? positionRows.reduce((sum, r) => sum + Number(r.position ?? 0), 0) / positionRows.length
    : null;

  const clickDelta = clicks - previousClicks;
  const impressionDelta = impressions - previousImpressions;
  const clickGrowthPct = previousClicks > 0 ? (clickDelta / previousClicks) * 100 : clicks > 0 ? 100 : null;
  const impressionGrowthPct =
    previousImpressions > 0 ? (impressionDelta / previousImpressions) * 100 : impressions > 0 ? 100 : null;

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
