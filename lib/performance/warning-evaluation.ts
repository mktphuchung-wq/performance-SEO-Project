import { withTransaction, type DbExecutor } from "@/lib/db";
import { attributionIndex, memberKeyOf, ownersOf } from "@/lib/performance/attribution";
import { urlContributions, type ScoreState, type UrlScoreResult } from "@/lib/performance/score";
import {
  WARNING_RULE_VERSION,
  clickDropPct,
  clickLoss,
  evaluateWarning,
  type WarningRangeKey,
  type WarningThresholds,
} from "@/lib/performance/warning";
import { getUrlAttributionForRange } from "@/lib/repositories/content-url-works";
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
 * The projection urlContributions actually reads. The other fields of a score
 * result are not recomputed here on purpose — this reads what was published, and
 * inventing ratios it did not read would be worse than leaving them null.
 */
function scoreResultOf(row: ScoreContributionRow): UrlScoreResult {
  return {
    state: row.score_state as ScoreState,
    clickRatio: null,
    impressionRatio: null,
    clickScore: null,
    impressionScore: null,
    score: row.score === null ? null : Number(row.score),
    weight: Number(row.weight ?? 0),
    baselineClicks: row.baseline_clicks,
    baselineImpressions: null,
  };
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

  const settingsSnapshot = { ...thresholds, urlWeightCapPct: kpiSettings.urlWeightCapPct };
  const pending: UpsertWarningInput[] = [];

  for (const rangeKey of WARNING_RANGES) {
    pending.push(
      ...(await candidatesForRange(db, {
        rangeKey,
        evaluationMonth,
        thresholds,
        urlWeightCapPct: kpiSettings.urlWeightCapPct,
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
    // Exactly the array this member was scored from, so the shares below are the
    // shares their KPI was actually taken over.
    const contributions = urlContributions(memberRows.map(scoreResultOf), ctx.urlWeightCapPct);
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
        },
        attributionSnapshot: {
          member_name: memberName,
          url_owner: row.member_name,
          owners: ownersOf(index, row).map((owner) => owner.member_name),
          window: { start_date: startDate, end_date: endDate },
        },
        settingsSnapshot: ctx.settingsSnapshot,
        rawScoreSnapshot: row.score === null ? null : Number(row.score),
        cappedWeightSnapshot: contribution.cappedWeight,
        memberTotalWeightSnapshot: memberTotalWeight,
        kpiDragPoints: contribution.dragPoints,
        consecutiveCount: verdict.consecutiveCount,
      });
    }
  }

  return out;
}
