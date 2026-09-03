import { query, type DbExecutor } from "@/lib/db";
import type { ScoreAggregate } from "@/lib/performance/score";
import type { RangeKey } from "@/lib/ranges";

export interface UpsertScoreRollupInput extends ScoreAggregate {
  key: string; // member_name or project
  rangeKey: RangeKey;
  startDate: string;
  endDate: string;
}

/** Column list shared by both score rollup tables, in insert order. */
const SCORE_COLUMNS = `range_key, start_date, end_date, kpi_score,
        eligible_url_count, excluded_url_count, no_data_url_count,
        capped_url_count, total_weight`;

const SCORE_UPDATE_SET = `start_date = excluded.start_date,
       end_date = excluded.end_date,
       kpi_score = excluded.kpi_score,
       eligible_url_count = excluded.eligible_url_count,
       excluded_url_count = excluded.excluded_url_count,
       no_data_url_count = excluded.no_data_url_count,
       capped_url_count = excluded.capped_url_count,
       total_weight = excluded.total_weight,
       refreshed_at = now(),
       updated_at = now()`;

function scoreValues(input: UpsertScoreRollupInput): unknown[] {
  return [
    input.rangeKey,
    input.startDate,
    input.endDate,
    input.kpiScore,
    input.eligibleUrlCount,
    input.excludedUrlCount,
    input.noDataUrlCount,
    input.cappedUrlCount,
    input.totalWeight,
  ];
}

/**
 * The member-only half of a score row: what the opposite-sign rule did, and
 * everything needed to explain the number it produced.
 *
 * Deliberately not part of UpsertScoreRollupInput. A project has no direction
 * adjustment, and giving both tables the same input type is exactly how the
 * rule would end up applied to a grain it was never meant for.
 */
export interface MemberScoreAdjustmentInput {
  baseKpiScore: number | null;
  clickComponentScore: number | null;
  impressionComponentScore: number | null;
  effectiveClickWeight: number | null;
  effectiveImpressionWeight: number | null;
  directionAdjustment: string;
  oppositeSignFactor: number | null;
  formulaVersion: string;
}

export interface UpsertMemberScoreInput extends UpsertScoreRollupInput, MemberScoreAdjustmentInput {}

/** Member-only columns, in insert order, appended after the shared ones. */
const MEMBER_ADJUSTMENT_COLUMNS = `base_kpi_score, click_component_score, impression_component_score,
        effective_click_weight, effective_impression_weight,
        direction_adjustment, opposite_sign_factor, formula_version`;

// Placed BEFORE the shared SCORE_UPDATE_SET, which ends in the two now() stamps
// and so cannot be extended from the outside.
const MEMBER_ADJUSTMENT_UPDATE_SET = `base_kpi_score = excluded.base_kpi_score,
       click_component_score = excluded.click_component_score,
       impression_component_score = excluded.impression_component_score,
       effective_click_weight = excluded.effective_click_weight,
       effective_impression_weight = excluded.effective_impression_weight,
       direction_adjustment = excluded.direction_adjustment,
       opposite_sign_factor = excluded.opposite_sign_factor,
       formula_version = excluded.formula_version,`;

export async function upsertMemberScore(memberEmail: string | null, input: UpsertMemberScoreInput, db?: DbExecutor): Promise<void> {
  const sql =
    `insert into public.member_performance_score
       (member_name, member_email, ${SCORE_COLUMNS}, ${MEMBER_ADJUSTMENT_COLUMNS}, refreshed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now(), now())
     on conflict (member_name, range_key) do update set
       member_email = excluded.member_email,
       ${MEMBER_ADJUSTMENT_UPDATE_SET}
       ${SCORE_UPDATE_SET}`;
  const params = [
    input.key,
    memberEmail,
    ...scoreValues(input),
    input.baseKpiScore,
    input.clickComponentScore,
    input.impressionComponentScore,
    input.effectiveClickWeight,
    input.effectiveImpressionWeight,
    input.directionAdjustment,
    input.oppositeSignFactor,
    input.formulaVersion,
  ];
  if (db) await db.query(sql, params);
  else await query(sql, params);
}

export async function upsertProjectScore(input: UpsertScoreRollupInput, db?: DbExecutor): Promise<void> {
  const sql =
    `insert into public.project_performance_score
       (project, ${SCORE_COLUMNS}, refreshed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())
      on conflict (project, range_key) do update set
        ${SCORE_UPDATE_SET}`;
  const params = [input.key, ...scoreValues(input)];
  if (db) await db.query(sql, params);
  else await query(sql, params);
}

/** Shape shared by both score rollup rows as they come back from Postgres. */
export interface ScoreRollupRow {
  range_key: string;
  start_date: string;
  end_date: string;
  kpi_score: number | null;
  eligible_url_count: number;
  excluded_url_count: number;
  no_data_url_count: number;
  capped_url_count: number;
  total_weight: number;
  refreshed_at: string;
}

/** What the opposite-sign rule did to one member's score, as stored. */
export interface MemberScoreAdjustment {
  base_kpi_score: number | null;
  click_component_score: number | null;
  impression_component_score: number | null;
  effective_click_weight: number | null;
  effective_impression_weight: number | null;
  direction_adjustment: string;
  opposite_sign_factor: number | null;
  formula_version: string;
}

/**
 * Member rows carry the adjustment columns; project rows deliberately do not.
 * That asymmetry is load-bearing for the UI — narrowing the score union on the
 * presence of direction_adjustment is what keeps the indicator off the project
 * view, which is scored on the configured weights and always was.
 */
export interface MemberScoreRow extends ScoreRollupRow, MemberScoreAdjustment {
  member_name: string;
  member_email: string | null;
}

export interface ProjectScoreRow extends ScoreRollupRow {
  project: string;
}

export async function listMemberScores(rangeKey: RangeKey): Promise<MemberScoreRow[]> {
  return query<MemberScoreRow>(
    "select * from public.member_performance_score where range_key = $1 order by kpi_score desc nulls last",
    [rangeKey],
  );
}

export async function getMemberScoreByEmail(email: string, rangeKey: RangeKey): Promise<MemberScoreRow | null> {
  const rows = await query<MemberScoreRow>(
    "select * from public.member_performance_score where range_key = $1 and lower(member_email) = lower($2)",
    [rangeKey, email],
  );
  return rows[0] ?? null;
}

export interface MemberScoreFormulaRow extends MemberScoreAdjustment {
  member_name: string;
  kpi_score: number | null;
}

/**
 * The weights each member was actually scored at for one range, keyed the same
 * way the scores were written.
 *
 * The Warning evaluator needs these rather than recomputing them: a warning that
 * quoted a drag derived from weights the published score was not taken over
 * would be arguing with the KPI it exists to explain. Takes a DbExecutor because
 * it runs inside the refresh transaction, reading rows computeAndStoreScores
 * wrote moments earlier.
 */
export async function getMemberScoreFormulaForRange(
  rangeKey: RangeKey,
  db?: DbExecutor,
): Promise<Map<string, MemberScoreFormulaRow>> {
  const sql = `select member_name, kpi_score, base_kpi_score,
            click_component_score, impression_component_score,
            effective_click_weight, effective_impression_weight,
            direction_adjustment, opposite_sign_factor, formula_version
       from public.member_performance_score
      where range_key = $1`;
  const rows = db
    ? (await db.query<MemberScoreFormulaRow>(sql, [rangeKey])).rows
    : await query<MemberScoreFormulaRow>(sql, [rangeKey]);
  return new Map(rows.map((row) => [row.member_name, row]));
}

export async function listProjectScores(rangeKey: RangeKey): Promise<ProjectScoreRow[]> {
  return query<ProjectScoreRow>(
    "select * from public.project_performance_score where range_key = $1 order by kpi_score desc nulls last",
    [rangeKey],
  );
}

/**
 * The three period scores for one member on one row, ready for Layer 3.
 *
 * Pivoted in SQL rather than fetched as three range queries and stitched in JS:
 * one round trip, and a member with only some of the periods still comes back
 * with the missing ones as null instead of silently dropping out of the result.
 *
 * Only the rolling ranges are read — all_time and custom have no previous window
 * to grow against, so they are not scored and cannot take part in the KPI.
 */
const COMPOSITE_SCORE_SELECT = `select member_name as "memberName",
            max(member_email) as "memberEmail",
            max(kpi_score) filter (where range_key = 'last_1_month')  as "score1m",
            max(kpi_score) filter (where range_key = 'last_3_months') as "score3m",
            max(kpi_score) filter (where range_key = 'last_6_months') as "score6m",
            max(base_kpi_score) filter (where range_key = 'last_1_month')  as "baseScore1m",
            max(base_kpi_score) filter (where range_key = 'last_3_months') as "baseScore3m",
            max(base_kpi_score) filter (where range_key = 'last_6_months') as "baseScore6m",
            max(direction_adjustment) filter (where range_key = 'last_1_month')  as "direction1m",
            max(direction_adjustment) filter (where range_key = 'last_3_months') as "direction3m",
            max(direction_adjustment) filter (where range_key = 'last_6_months') as "direction6m",
            max(refreshed_at) as "refreshedAt"
       from public.member_performance_score
      where range_key in ('last_1_month', 'last_3_months', 'last_6_months')`;

export interface MemberCompositeScoreInputRow {
  memberName: string;
  memberEmail: string | null;
  score1m: number | null;
  score3m: number | null;
  score6m: number | null;
  /** The 70/30 score each period would have had. Null on rows written before the rule existed. */
  baseScore1m: number | null;
  baseScore3m: number | null;
  baseScore6m: number | null;
  /** Which period scores the opposite-sign rule touched, so the UI can say so per tile. */
  direction1m: string | null;
  direction3m: string | null;
  direction6m: string | null;
  refreshedAt: string | null;
}

export async function listMemberCompositeScoreInputs(): Promise<MemberCompositeScoreInputRow[]> {
  return query<MemberCompositeScoreInputRow>(`${COMPOSITE_SCORE_SELECT} group by member_name order by member_name`);
}

export async function getMemberCompositeScoreInputsByEmail(
  email: string,
): Promise<MemberCompositeScoreInputRow | null> {
  const rows = await query<MemberCompositeScoreInputRow>(
    `${COMPOSITE_SCORE_SELECT} and lower(member_email) = lower($1) group by member_name order by member_name`,
    [email],
  );
  if (rows.length <= 1) return rows[0] ?? null;

  // One Google account mapped to more than one Sheet name. Merging would invent
  // a member who does not exist, so the most recently refreshed identity wins
  // and the rest are left to the admin's member-alias mapping to sort out.
  return [...rows].sort((a, b) => String(b.refreshedAt ?? "").localeCompare(String(a.refreshedAt ?? "")))[0];
}
