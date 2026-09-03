import { withTransaction, type DbExecutor } from "@/lib/db";
import { attributionIndex, memberKeyOf, ownersOf } from "@/lib/performance/attribution";
import {
  LEGACY_FORMULA_VERSION,
  urlContributions,
  type ScoreState,
  type UrlScoreResult,
} from "@/lib/performance/score";
import {
  WARNING_RULE_VERSION,
  clickDropPct,
  clickLoss,
  evaluateWarning,
  type WarningRangeKey,
  type WarningThresholds,
} from "@/lib/performance/warning";
import { getUrlAttributionForRange } from "@/lib/repositories/content-url-works";
import { getMemberScoreFormulaForRange } from "@/lib/repositories/kpi-score-rollups";
import { getKpiSettings, getWarningSettings } from "@/lib/repositories/kpi-settings";
import { linkWarningToAudit, openAudit } from "@/lib/repositories/url-kpi-audits";
import {
  bulkUpsertWarnings,
  getPriorConsecutiveCounts,
  resolveStaleWarnings,
  warningKey,
  type UpsertWarningInput,
} from "@/lib/repositories/url-kpi-warnings";
import {
  getScoreContributionRowsForRange,
  type ScoreContributionRow,
} from "@/lib/repositories/url-performance-score";
import { closedCalendarMonths, computeRangeDates } from "@/lib/ranges";

/** Warnings are defined on 1M and 3M only. 6M has no rule of its own. */
const WARNING_RANGES: WarningRangeKey[] = ["last_1_month", "last_3_months"];

export interface WarningEvaluationResult {
  evaluationMonth: string;
  warningsWritten: number;
  earlyWarnings: number;
  mandatoryAudits: number;
  auditsOpened: number;
  auditsLinked: number;
  recoveredWarnings: number;
  rangesEvaluated: WarningRangeKey[];
}

/**
 * The projection urlContributions actually reads, plus the two component scores
 * the effective blend needs. The remaining fields of a score result are not
 * recomputed here on purpose — this reads what was published, and inventing
 * ratios it did not read would be worse than leaving them null.
 */
function scoreResultOf(row: ScoreContributionRow): UrlScoreResult {
  return {
    state: row.score_state as ScoreState,
    clickRatio: null,
    impressionRatio: null,
    clickScore: row.click_score === null ? null : Number(row.click_score),
    impressionScore: row.impression_score === null ? null : Number(row.impression_score),
    score: row.score === null ? null : Number(row.score),
    weight: Number(row.weight ?? 0),
    baselineClicks: row.baseline_clicks,
    baselineImpressions: null,
  };
}

/**
 * The score one URL is worth to one member, at the weights that member's own KPI
 * was taken over.
 *
 * Falls back to the published score whenever the components are missing — a row
 * written before migration 015, or a member with no stored score row yet. That
 * fallback is exactly the previous behaviour, so a gap in the data degrades to
 * the old drag figure rather than to a silent zero.
 */
function effectiveScoreOf(
  result: UrlScoreResult,
  clickWeight: number,
  impressionWeight: number,
): number {
  if (result.clickScore === null || result.impressionScore === null) return result.score ?? 0;
  return Math.max(0, Math.min(100, clickWeight * result.clickScore + impressionWeight * result.impressionScore));
}

/**
 * Evaluate one closed month and write the warnings it produces.
 *
 * Stamped to a closed calendar month rather than to the rolling window it
 * measures. The 1M/3M windows move every time the Search Console cutoff
 * advances, so two refreshes days apart cover almost exactly the same traffic —
 * treating those as two independent periods would both re-fire every warning and
 * turn "two consecutive periods" into "two days". Running this repeatedly inside
 * one month updates the same rows.
 *
 * Nothing here changes a score. It writes warnings, opens audits, and closes
 * warnings that stopped triggering. The KPI it reports on is the one it read.
 */
export async function evaluateWarningsForClosedMonth(options: {
  actorId: string | null;
  evaluationMonth?: string;
  db?: DbExecutor;
}): Promise<WarningEvaluationResult> {
  if (options.db) return runEvaluation(options.db, options);
  return withTransaction((client) => runEvaluation(client, options));
}

async function runEvaluation(
  db: DbExecutor,
  options: { actorId: string | null; evaluationMonth?: string },
): Promise<WarningEvaluationResult> {
  const evaluationMonth = options.evaluationMonth ?? closedCalendarMonths(1)[0]?.startDate;
  if (!evaluationMonth) {
    throw new Error("No closed calendar month is available to evaluate yet");
  }

  const thresholds = await getWarningSettings(db);
  const kpiSettings = await getKpiSettings(db);
  const priorCounts = await getPriorConsecutiveCounts(evaluationMonth, db);

  // The configured weights go into the snapshot too: every warning now records
  // both what the settings said and what this member was actually weighed at,
  // which is the pair a drag figure has to be read against.
  const settingsSnapshot = {
    ...thresholds,
    urlWeightCapPct: kpiSettings.urlWeightCapPct,
    clickWeight: kpiSettings.clickWeight,
    impressionWeight: kpiSettings.impressionWeight,
  };
  const pending: UpsertWarningInput[] = [];

  for (const rangeKey of WARNING_RANGES) {
    pending.push(
      ...(await candidatesForRange(db, {
        rangeKey,
        evaluationMonth,
        thresholds,
        urlWeightCapPct: kpiSettings.urlWeightCapPct,
        clickWeight: kpiSettings.clickWeight,
        impressionWeight: kpiSettings.impressionWeight,
        settingsSnapshot,
        priorCounts,
      })),
    );
  }

  const written = await bulkUpsertWarnings(pending, db);
  const recoveredWarnings = await resolveStaleWarnings(evaluationMonth, db);

  // A mandatory audit is a case to open, not a score to change. The partial
  // unique index means a URL already under investigation collects the new
  // warning rather than a second case.
  let auditsOpened = 0;
  let auditsLinked = 0;
  const actorId = options.actorId ?? "system";
  for (const warning of written) {
    if (warning.level !== "mandatory_audit") continue;
    const { audit, created } = await openAudit(
      {
        contentUrlId: warning.content_url_id,
        openedBy: actorId,
        slaDays: thresholds.auditSlaDays,
        detail: { trigger: "mandatory_audit", evaluation_month: evaluationMonth, range_key: warning.range_key },
      },
      db,
    );
    if (created) auditsOpened += 1;
    await linkWarningToAudit(db, {
      warningId: warning.id,
      auditId: audit.id,
      contentUrlId: warning.content_url_id,
      actorId,
      detail: { member_name: warning.member_name, range_key: warning.range_key, evaluation_month: evaluationMonth },
    });
    auditsLinked += 1;
  }

  return {
    evaluationMonth,
    warningsWritten: written.length,
    earlyWarnings: written.filter((w) => w.level === "early_warning").length,
    mandatoryAudits: written.filter((w) => w.level === "mandatory_audit").length,
    auditsOpened,
    auditsLinked,
    recoveredWarnings,
    rangesEvaluated: WARNING_RANGES,
  };
}

/**
 * Every warning one range produces, for every member.
 *
 * The per-member loop is the whole point of the grain. A URL carried by two
 * members drags each of them by a different number of points, because each has a
 * different set of other URLs to be weighed against — so the same decline
 * produces two warnings with two impacts, not one shared verdict.
 */
async function candidatesForRange(
  db: DbExecutor,
  ctx: {
    rangeKey: WarningRangeKey;
    evaluationMonth: string;
    thresholds: WarningThresholds;
    urlWeightCapPct: number;
    clickWeight: number;
    impressionWeight: number;
    settingsSnapshot: Record<string, unknown>;
    priorCounts: Map<string, number>;
  },
): Promise<UpsertWarningInput[]> {
  const rows = await getScoreContributionRowsForRange(ctx.rangeKey, db);
  if (rows.length === 0) return [];

  // The window the published scores were actually computed over, not today's.
  const fallback = computeRangeDates(ctx.rangeKey);
  const startDate = rows[0].start_date ?? fallback.startDate;
  const endDate = rows[0].end_date ?? fallback.endDate;

  // The weights each member's published score was taken over. Read, not
  // recomputed: this and the score row have to agree, or the drag would not add
  // back up to the KPI it claims to explain.
  const formulaByMember = await getMemberScoreFormulaForRange(ctx.rangeKey, db);

  const index = attributionIndex(await getUrlAttributionForRange(startDate, endDate, db));
  const byMember = new Map<string, ScoreContributionRow[]>();
  for (const row of rows) {
    for (const owner of ownersOf(index, row)) {
      const key = memberKeyOf(owner.member_name);
      if (!byMember.has(key)) byMember.set(key, []);
      byMember.get(key)!.push(row);
    }
  }

  const out: UpsertWarningInput[] = [];
  for (const [memberName, memberRows] of byMember) {
    // A member with no stored score row, or a row from before migration 015,
    // falls back to the configured weights — which reproduces the previous drag
    // exactly rather than skipping the member's warnings altogether.
    const formula = formulaByMember.get(memberName);
    const effectiveClickWeight = formula?.effective_click_weight ?? ctx.clickWeight;
    const effectiveImpressionWeight = formula?.effective_impression_weight ?? ctx.impressionWeight;
    const memberSnapshot = {
      ...ctx.settingsSnapshot,
      effective_click_weight: effectiveClickWeight,
      effective_impression_weight: effectiveImpressionWeight,
      direction_adjustment: formula?.direction_adjustment ?? "none",
      opposite_sign_factor: formula?.opposite_sign_factor ?? null,
      formula_version: formula?.formula_version ?? LEGACY_FORMULA_VERSION,
      member_kpi_score: formula?.kpi_score ?? null,
      base_kpi_score: formula?.base_kpi_score ?? null,
      click_component_score: formula?.click_component_score ?? null,
      impression_component_score: formula?.impression_component_score ?? null,
    };

    // Exactly the array this member was scored from, so the shares below are the
    // shares their KPI was actually taken over. Only the score each share is
    // multiplied by changes with the member's weights; the weights themselves
    // are the same capped traffic shares as ever.
    const contributions = urlContributions(
      memberRows.map(scoreResultOf),
      ctx.urlWeightCapPct,
      (result) => effectiveScoreOf(result, effectiveClickWeight, effectiveImpressionWeight),
    );
    const memberTotalWeight = contributions.reduce((sum, c) => sum + c.cappedWeight, 0);

    for (const contribution of contributions) {
      const row = memberRows[contribution.index];
      const key = warningKey({
        contentUrlId: row.content_url_id,
        memberName,
        rangeKey: ctx.rangeKey,
      });

      const verdict = evaluateWarning(
        {
          rangeKey: ctx.rangeKey,
          dataStatus: row.data_status,
          // The ceiling gate stays on the published URL score. It is a statement
          // about the URL — which has not changed — while the drag below is a
          // statement about what this URL costs this member.
          score: row.score === null ? null : Number(row.score),
          currentClicks: row.current_clicks,
          baselineClicks: row.baseline_clicks,
          dragPoints: contribution.dragPoints,
          priorConsecutiveCount: ctx.priorCounts.get(key) ?? 0,
        },
        ctx.thresholds,
      );
      if (!verdict) continue;

      out.push({
        contentUrlId: row.content_url_id,
        memberName,
        rangeKey: ctx.rangeKey,
        evaluationMonth: ctx.evaluationMonth,
        startDate,
        endDate,
        ruleVersion: WARNING_RULE_VERSION,
        level: verdict.level,
        // Enough to explain the warning once the rolling window has moved on and
        // url_performance_score has been overwritten by the next refresh.
        metricSnapshot: {
          current_clicks: row.current_clicks,
          baseline_clicks: row.baseline_clicks,
          baseline_sample_count: row.baseline_sample_count,
          click_drop_pct: clickDropPct(row.current_clicks, row.baseline_clicks),
          click_loss: clickLoss(row.current_clicks, row.baseline_clicks),
          data_status: row.data_status,
          score_state: row.score_state,
          raw_weight: contribution.weight,
          weight_share: contribution.weightShare,
          url_click_score: row.click_score,
          url_impression_score: row.impression_score,
          raw_url_score: contribution.score,
          effective_url_score: contribution.effectiveScore,
        },
        attributionSnapshot: {
          member_name: memberName,
          url_owner: row.member_name,
          owners: ownersOf(index, row).map((owner) => owner.member_name),
          window: { start_date: startDate, end_date: endDate },
        },
        settingsSnapshot: memberSnapshot,
        rawScoreSnapshot: row.score === null ? null : Number(row.score),
        effectiveScoreSnapshot: contribution.effectiveScore,
        cappedWeightSnapshot: contribution.cappedWeight,
        memberTotalWeightSnapshot: memberTotalWeight,
        kpiDragPoints: contribution.dragPoints,
        consecutiveCount: verdict.consecutiveCount,
      });
    }
  }

  return out;
}
