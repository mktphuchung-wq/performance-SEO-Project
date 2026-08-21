import { query } from "@/lib/db";
import type { KpiPeriodWeights, KpiStrategy } from "@/lib/performance/composite-score";

export interface MemberKpiWeightsRow {
  member_name: string;
  strategy: KpiStrategy;
  weight_1m: number;
  weight_3m: number;
  weight_6m: number;
  note: string | null;
  updated_at: string;
}

export function weightsOf(row: MemberKpiWeightsRow): KpiPeriodWeights {
  return {
    last_1_month: Number(row.weight_1m),
    last_3_months: Number(row.weight_3m),
    last_6_months: Number(row.weight_6m),
  };
}

export async function listMemberKpiWeights(): Promise<MemberKpiWeightsRow[]> {
  return query<MemberKpiWeightsRow>("select * from public.member_kpi_weights order by member_name");
}

/**
 * Overrides keyed the way the score rows are, so Layer 3 can look a member up
 * without another query. Members with no row are simply absent — the caller
 * falls back to the team default, which is what "no personal strategy set"
 * means.
 */
export async function getMemberKpiWeightsMap(): Promise<
  Map<string, { weights: KpiPeriodWeights; strategy: KpiStrategy }>
> {
  const rows = await listMemberKpiWeights();
  return new Map(rows.map((row) => [row.member_name, { weights: weightsOf(row), strategy: row.strategy }]));
}

export async function getMemberKpiWeights(memberName: string): Promise<MemberKpiWeightsRow | null> {
  const rows = await query<MemberKpiWeightsRow>("select * from public.member_kpi_weights where member_name = $1", [
    memberName,
  ]);
  return rows[0] ?? null;
}

export interface UpsertMemberKpiWeightsInput {
  memberName: string;
  strategy: KpiStrategy;
  weights: KpiPeriodWeights;
  note?: string | null;
}

export async function upsertMemberKpiWeights(input: UpsertMemberKpiWeightsInput): Promise<void> {
  await query(
    `insert into public.member_kpi_weights (member_name, strategy, weight_1m, weight_3m, weight_6m, note)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (member_name) do update set
       strategy = excluded.strategy,
       weight_1m = excluded.weight_1m,
       weight_3m = excluded.weight_3m,
       weight_6m = excluded.weight_6m,
       note = excluded.note,
       updated_at = now()`,
    [
      input.memberName,
      input.strategy,
      input.weights.last_1_month,
      input.weights.last_3_months,
      input.weights.last_6_months,
      input.note ?? null,
    ],
  );
}

/** Removing the override puts the member back on the team default, not on zero. */
export async function deleteMemberKpiWeights(memberName: string): Promise<void> {
  await query("delete from public.member_kpi_weights where member_name = $1", [memberName]);
}
