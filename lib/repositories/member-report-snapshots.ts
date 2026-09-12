import type { QueryResultRow } from "pg";
import { withTransaction } from "@/lib/db";
import type { DataStatus, GrowthStatus } from "@/lib/performance/growth";
import type { ScoreState } from "@/lib/performance/score";

export const MEMBER_REPORT_RANGE_KEYS = ["last_1_month", "last_3_months", "last_6_months"] as const;

export type MemberReportRangeKey = (typeof MEMBER_REPORT_RANGE_KEYS)[number];
export type MemberReportCompletionState = "publishing" | "complete";

export interface MemberReportSnapshotRow {
  id: string;
  report_month: string;
  member_name: string;
  member_email: string | null;
  completion_state: MemberReportCompletionState;
  completed_at: string | null;
  created_at: string;
}

export interface MemberReportSummarySnapshotRow {
  report_snapshot_id: string;
  range_key: MemberReportRangeKey;
  start_date: string;
  end_date: string;
  previous_start_date: string;
  previous_end_date: string;
  url_count: number;
  urls_with_data: number;
  growing_urls: number;
  stable_urls: number;
  declining_urls: number;
  no_data_urls: number;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  previous_clicks: number | null;
  previous_impressions: number | null;
  click_delta: number | null;
  click_growth_pct: number | null;
  impression_delta: number | null;
  impression_growth_pct: number | null;
  kpi_score: number | null;
  eligible_url_count: number;
  excluded_url_count: number;
  no_data_url_count: number;
  capped_url_count: number;
  total_weight: number;
  base_kpi_score: number | null;
  click_component_score: number | null;
  impression_component_score: number | null;
  effective_click_weight: number | null;
  effective_impression_weight: number | null;
  direction_adjustment: string;
  opposite_sign_factor: number | null;
  formula_version: string;
}

export interface MemberReportUrlSnapshotRow {
  report_snapshot_id: string;
  content_url_id: string;
  range_key: MemberReportRangeKey;
  url_hash: string;
  content_hash: string | null;
  project: string;
  url: string;
  member_name: string;
  member_email: string | null;
  work_type: string;
  gsc_property: string | null;
  is_active: boolean;
  worked_at: string | null;
  first_worked_at: string | null;
  published_at: string | null;
  kpi_excluded: boolean;
  kpi_excluded_reason: string | null;
  start_date: string;
  end_date: string;
  previous_start_date: string;
  previous_end_date: string;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
  previous_clicks: number | null;
  previous_impressions: number | null;
  previous_ctr: number | null;
  previous_position: number | null;
  click_delta: number | null;
  click_growth_pct: number | null;
  impression_delta: number | null;
  impression_growth_pct: number | null;
  growth_status: GrowthStatus;
  data_status: DataStatus;
  error_message: string | null;
  score_state: ScoreState;
  kpi_score: number | null;
  weight: number;
}

export type MemberReportSummarySnapshotInput = Omit<MemberReportSummarySnapshotRow, "report_snapshot_id">;
export type MemberReportUrlSnapshotInput = Omit<MemberReportUrlSnapshotRow, "report_snapshot_id">;

export interface PublishMemberReportSnapshotInput {
  reportMonth: string;
  memberName: string;
  memberEmail: string | null;
  summaries: MemberReportSummarySnapshotInput[];
  urls: MemberReportUrlSnapshotInput[];
}

export interface CompleteMemberReportSnapshot {
  report: MemberReportSnapshotRow;
  summaries: MemberReportSummarySnapshotRow[];
  urls: MemberReportUrlSnapshotRow[];
}

export interface PublishMemberReportSnapshotResult {
  snapshot: CompleteMemberReportSnapshot;
  created: boolean;
}

const SUMMARY_COLUMNS = `range_key, start_date, end_date, previous_start_date, previous_end_date,
  url_count, urls_with_data, growing_urls, stable_urls, declining_urls, no_data_urls,
  clicks, impressions, ctr, position, previous_clicks, previous_impressions,
  click_delta, click_growth_pct, impression_delta, impression_growth_pct,
  kpi_score, eligible_url_count, excluded_url_count, no_data_url_count, capped_url_count, total_weight,
  base_kpi_score, click_component_score, impression_component_score,
  effective_click_weight, effective_impression_weight, direction_adjustment, opposite_sign_factor, formula_version`;

const URL_COLUMNS = `content_url_id, range_key, url_hash, content_hash, project, url, member_name, member_email,
  work_type, gsc_property, is_active, worked_at, first_worked_at, published_at, kpi_excluded, kpi_excluded_reason,
  start_date, end_date, previous_start_date, previous_end_date,
  clicks, impressions, ctr, position, previous_clicks, previous_impressions, previous_ctr, previous_position,
  click_delta, click_growth_pct, impression_delta, impression_growth_pct,
  growth_status, data_status, error_message, score_state, kpi_score, weight`;

const SUMMARY_RECORD = `range_key text, start_date date, end_date date, previous_start_date date, previous_end_date date,
  url_count integer, urls_with_data integer, growing_urls integer, stable_urls integer, declining_urls integer, no_data_urls integer,
  clicks numeric, impressions numeric, ctr numeric, position numeric, previous_clicks numeric, previous_impressions numeric,
  click_delta numeric, click_growth_pct numeric, impression_delta numeric, impression_growth_pct numeric,
  kpi_score numeric, eligible_url_count integer, excluded_url_count integer, no_data_url_count integer,
  capped_url_count integer, total_weight numeric, base_kpi_score numeric, click_component_score numeric,
  impression_component_score numeric, effective_click_weight numeric, effective_impression_weight numeric,
  direction_adjustment text, opposite_sign_factor numeric, formula_version text`;

const URL_RECORD = `content_url_id uuid, range_key text, url_hash text, content_hash text, project text, url text,
  member_name text, member_email text, work_type text, gsc_property text, is_active boolean,
  worked_at date, first_worked_at date, published_at date, kpi_excluded boolean, kpi_excluded_reason text,
  start_date date, end_date date, previous_start_date date, previous_end_date date,
  clicks numeric, impressions numeric, ctr numeric, position numeric, previous_clicks numeric, previous_impressions numeric,
  previous_ctr numeric, previous_position numeric, click_delta numeric, click_growth_pct numeric,
  impression_delta numeric, impression_growth_pct numeric, growth_status text, data_status text,
  error_message text, score_state text, kpi_score numeric, weight numeric`;

function monthStart(reportMonth: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])(?:-01)?$/.test(reportMonth)) {
    throw new Error("reportMonth must be YYYY-MM or YYYY-MM-01");
  }
  return `${reportMonth.slice(0, 7)}-01`;
}

function assertPayload(input: PublishMemberReportSnapshotInput): void {
  const expected = new Set<MemberReportRangeKey>(MEMBER_REPORT_RANGE_KEYS);
  if (input.summaries.length !== expected.size || input.summaries.some((row) => !expected.delete(row.range_key)) || expected.size !== 0) {
    throw new Error("summaries must contain each member report range exactly once");
  }

  const seenUrls = new Set<string>();
  const urlRanges = new Map<string, Set<MemberReportRangeKey>>();
  for (const row of input.urls) {
    if (!MEMBER_REPORT_RANGE_KEYS.includes(row.range_key)) throw new Error(`Unsupported report range: ${row.range_key}`);
    if (row.member_name !== input.memberName || row.member_email !== input.memberEmail) {
      throw new Error("URL member metadata must match report member metadata");
    }
    seenUrls.add(row.content_url_id);
    const ranges = urlRanges.get(row.content_url_id) ?? new Set<MemberReportRangeKey>();
    if (ranges.has(row.range_key)) throw new Error(`Duplicate URL/range snapshot: ${row.content_url_id}/${row.range_key}`);
    ranges.add(row.range_key);
    urlRanges.set(row.content_url_id, ranges);
  }
  for (const contentUrlId of seenUrls) {
    if (urlRanges.get(contentUrlId)?.size !== MEMBER_REPORT_RANGE_KEYS.length) {
      throw new Error(`URL snapshot must contain all report ranges: ${contentUrlId}`);
    }
  }
}

function resultRows<T extends QueryResultRow>(result: { rows: T[] }): T[] {
  return result.rows;
}

export async function getCompleteMemberReportSnapshot(
  memberIdentity: string,
  reportMonth: string,
): Promise<CompleteMemberReportSnapshot | null> {
  const byEmail = memberIdentity.includes("@");
  return getCompleteMemberReportSnapshotForMember(
    byEmail ? { memberEmail: memberIdentity } : { memberName: memberIdentity },
    reportMonth,
  );
}

export interface MemberReportIdentity {
  memberName?: string | null;
  memberEmail?: string | null;
}

export async function getCompleteMemberReportSnapshotForMember(
  identity: MemberReportIdentity,
  reportMonth: string,
): Promise<CompleteMemberReportSnapshot | null> {
  const memberName = identity.memberName?.trim() || null;
  const memberEmail = identity.memberEmail?.trim().toLowerCase() || null;
  return withTransaction(async (client) => {
    await client.query("set transaction isolation level repeatable read read only");
    const rows = resultRows(await client.query<MemberReportSnapshotRow>(
      `select id, report_month, member_name, member_email, completion_state, completed_at, created_at
       from public.member_report_snapshots
       where report_month = $1 and completion_state = 'complete'
         and (($2::text is not null and lower(member_email) = lower($2))
           or ($3::text is not null and member_name = $3))
       order by case when $2::text is not null and lower(member_email) = lower($2) then 0 else 1 end,
                created_at desc
       limit 1`,
      [monthStart(reportMonth), memberEmail, memberName],
    ));
    const report = rows[0];
    if (!report) return null;

    const summaries = resultRows(await client.query<MemberReportSummarySnapshotRow>(
      `select report_snapshot_id, ${SUMMARY_COLUMNS}
       from public.member_report_summary_snapshots
       where report_snapshot_id = $1
       order by array_position($2::text[], range_key)`,
      [report.id, MEMBER_REPORT_RANGE_KEYS],
    ));
    const urls = resultRows(await client.query<MemberReportUrlSnapshotRow>(
      `select report_snapshot_id, ${URL_COLUMNS}
       from public.member_report_url_snapshots
       where report_snapshot_id = $1
       order by url, array_position($2::text[], range_key)`,
      [report.id, MEMBER_REPORT_RANGE_KEYS],
    ));

    return { report, summaries, urls };
  });
}

export async function publishMemberReportSnapshot(
  input: PublishMemberReportSnapshotInput,
): Promise<PublishMemberReportSnapshotResult> {
  assertPayload(input);
  const reportMonth = monthStart(input.reportMonth);

  return withTransaction(async (client) => {
    const identity = input.memberEmail?.trim().toLowerCase() || input.memberName;
    await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [identity, reportMonth]);
    const existingRows = resultRows(await client.query<MemberReportSnapshotRow>(
      `select id, report_month, member_name, member_email, completion_state, completed_at, created_at
       from public.member_report_snapshots
       where report_month = $2
         and (($3::text is not null and lower(member_email) = lower($3))
           or ($3::text is null and member_email is null and member_name = $1))
       for update`,
      [input.memberName, reportMonth, input.memberEmail],
    ));
    const existing = existingRows[0];

    if (existing?.completion_state === "complete") {
      const [summaries, urls] = await Promise.all([
        client.query<MemberReportSummarySnapshotRow>(
          `select report_snapshot_id, ${SUMMARY_COLUMNS}
           from public.member_report_summary_snapshots where report_snapshot_id = $1
           order by array_position($2::text[], range_key)`,
          [existing.id, MEMBER_REPORT_RANGE_KEYS],
        ),
        client.query<MemberReportUrlSnapshotRow>(
          `select report_snapshot_id, ${URL_COLUMNS}
           from public.member_report_url_snapshots where report_snapshot_id = $1
           order by url, array_position($2::text[], range_key)`,
          [existing.id, MEMBER_REPORT_RANGE_KEYS],
        ),
      ]);
      return { snapshot: { report: existing, summaries: summaries.rows, urls: urls.rows }, created: false };
    }

    let report: MemberReportSnapshotRow;
    if (existing) {
      report = resultRows(await client.query<MemberReportSnapshotRow>(
        `update public.member_report_snapshots
         set member_email = $2, completion_state = 'publishing', completed_at = null
         where id = $1
         returning id, report_month, member_name, member_email, completion_state, completed_at, created_at`,
        [existing.id, input.memberEmail],
      ))[0];
      await client.query("delete from public.member_report_summary_snapshots where report_snapshot_id = $1", [existing.id]);
      await client.query("delete from public.member_report_url_snapshots where report_snapshot_id = $1", [existing.id]);
    } else {
      report = resultRows(await client.query<MemberReportSnapshotRow>(
        `insert into public.member_report_snapshots (report_month, member_name, member_email)
         values ($1, $2, $3)
         returning id, report_month, member_name, member_email, completion_state, completed_at, created_at`,
        [reportMonth, input.memberName, input.memberEmail],
      ))[0];
    }

    await client.query(
      `insert into public.member_report_summary_snapshots (report_snapshot_id, ${SUMMARY_COLUMNS})
       select $1, ${SUMMARY_COLUMNS} from jsonb_to_recordset($2::jsonb) as x(${SUMMARY_RECORD})`,
      [report.id, JSON.stringify(input.summaries)],
    );
    if (input.urls.length > 0) {
      await client.query(
        `insert into public.member_report_url_snapshots (report_snapshot_id, ${URL_COLUMNS})
         select $1, ${URL_COLUMNS} from jsonb_to_recordset($2::jsonb) as x(${URL_RECORD})`,
        [report.id, JSON.stringify(input.urls)],
      );
    }

    report = resultRows(await client.query<MemberReportSnapshotRow>(
      `update public.member_report_snapshots
       set completion_state = 'complete', completed_at = now()
       where id = $1
       returning id, report_month, member_name, member_email, completion_state, completed_at, created_at`,
      [report.id],
    ))[0];

    const [summaries, urls] = await Promise.all([
      client.query<MemberReportSummarySnapshotRow>(
        `select report_snapshot_id, ${SUMMARY_COLUMNS}
         from public.member_report_summary_snapshots where report_snapshot_id = $1
         order by array_position($2::text[], range_key)`,
        [report.id, MEMBER_REPORT_RANGE_KEYS],
      ),
      client.query<MemberReportUrlSnapshotRow>(
        `select report_snapshot_id, ${URL_COLUMNS}
         from public.member_report_url_snapshots where report_snapshot_id = $1
         order by url, array_position($2::text[], range_key)`,
        [report.id, MEMBER_REPORT_RANGE_KEYS],
      ),
    ]);

    return { snapshot: { report, summaries: summaries.rows, urls: urls.rows }, created: true };
  });
}
