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

export async function upsertMemberScore(memberEmail: string | null, input: UpsertScoreRollupInput, db?: DbExecutor): Promise<void> {
  const sql =
    `insert into public.member_performance_score
       (member_name, member_email, ${SCORE_COLUMNS}, refreshed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), now())
     on conflict (member_name, range_key) do update set
       member_email = excluded.member_email,
       ${SCORE_UPDATE_SET}`;
  const params = [input.key, memberEmail, ...scoreValues(input)];
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

export interface MemberScoreRow extends ScoreRollupRow {
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
            max(refreshed_at) as "refreshedAt"
       from public.member_performance_score
      where range_key in ('last_1_month', 'last_3_months', 'last_6_months')`;

export interface MemberCompositeScoreInputRow {
  memberName: string;
  memberEmail: string | null;
  score1m: number | null;
  score3m: number | null;
  score6m: number | null;
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
