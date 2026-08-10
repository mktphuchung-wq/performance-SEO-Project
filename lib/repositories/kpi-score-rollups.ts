import { query } from "@/lib/db";
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
        eligible_url_count, normal_url_count, new_grace_url_count, excluded_url_count,
        no_data_url_count, capped_url_count, total_weight`;

const SCORE_UPDATE_SET = `start_date = excluded.start_date,
       end_date = excluded.end_date,
       kpi_score = excluded.kpi_score,
       eligible_url_count = excluded.eligible_url_count,
       normal_url_count = excluded.normal_url_count,
       new_grace_url_count = excluded.new_grace_url_count,
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
    input.normalUrlCount,
    input.newGraceUrlCount,
    input.excludedUrlCount,
    input.noDataUrlCount,
    input.cappedUrlCount,
    input.totalWeight,
  ];
}

export async function upsertMemberScore(memberEmail: string | null, input: UpsertScoreRollupInput): Promise<void> {
  await query(
    `insert into public.member_performance_score
       (member_name, member_email, ${SCORE_COLUMNS}, refreshed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), now())
     on conflict (member_name, range_key) do update set
       member_email = excluded.member_email,
       ${SCORE_UPDATE_SET}`,
    [input.key, memberEmail, ...scoreValues(input)],
  );
}

export async function upsertProjectScore(input: UpsertScoreRollupInput): Promise<void> {
  await query(
    `insert into public.project_performance_score
       (project, ${SCORE_COLUMNS}, refreshed_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
     on conflict (project, range_key) do update set
       ${SCORE_UPDATE_SET}`,
    [input.key, ...scoreValues(input)],
  );
}

/** Shape shared by both score rollup rows as they come back from Postgres. */
export interface ScoreRollupRow {
  range_key: string;
  start_date: string;
  end_date: string;
  kpi_score: number | null;
  eligible_url_count: number;
  normal_url_count: number;
  new_grace_url_count: number;
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
