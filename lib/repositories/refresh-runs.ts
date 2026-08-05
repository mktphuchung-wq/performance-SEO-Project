import { query, queryOne } from "@/lib/db";
import type { RangeDates } from "@/lib/ranges";

export interface RefreshRun {
  id: string;
  status: "running" | "success" | "failed";
  range_key: string;
  start_date: string;
  end_date: string;
  previous_start_date: string;
  previous_end_date: string;
  total_urls: number;
  processed_urls: number;
  urls_with_data: number;
  no_data_urls: number;
  failed_urls: number;
  pending_content_url_ids: string[];
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export async function createRefreshRun(
  triggeredBy: string | null,
  range: RangeDates,
  contentUrlIds: string[],
): Promise<RefreshRun> {
  const row = await queryOne<RefreshRun>(
    `insert into public.refresh_runs
       (status, triggered_by, range_key, start_date, end_date, previous_start_date, previous_end_date,
        total_urls, pending_content_url_ids)
     values ('running', $1, $2, $3, $4, $5, $6, $7, $8)
     returning *`,
    [
      triggeredBy,
      range.rangeKey,
      range.startDate,
      range.endDate,
      range.previousStartDate,
      range.previousEndDate,
      contentUrlIds.length,
      contentUrlIds,
    ],
  );
  if (!row) throw new Error("Failed to create refresh_run");
  return row;
}

export async function getRefreshRun(id: string): Promise<RefreshRun | null> {
  return queryOne<RefreshRun>("select * from public.refresh_runs where id = $1", [id]);
}

export async function advanceRefreshRun(
  id: string,
  processedIds: string[],
  outcomeCounts: { withData: number; noData: number; failed: number },
): Promise<RefreshRun> {
  const row = await queryOne<RefreshRun>(
    `update public.refresh_runs
     set processed_urls = processed_urls + $2,
         urls_with_data = urls_with_data + $3,
         no_data_urls = no_data_urls + $4,
         failed_urls = failed_urls + $5,
         pending_content_url_ids = array(
           select unnest(pending_content_url_ids) except select unnest($6::uuid[])
         ),
         updated_at = now()
     where id = $1
     returning *`,
    [id, processedIds.length, outcomeCounts.withData, outcomeCounts.noData, outcomeCounts.failed, processedIds],
  );
  if (!row) throw new Error("refresh_run not found");
  return row;
}

export async function finishRefreshRun(id: string, status: "success" | "failed", errorMessage?: string): Promise<void> {
  await query(
    "update public.refresh_runs set status = $2, error_message = $3, finished_at = now(), updated_at = now() where id = $1",
    [id, status, errorMessage ?? null],
  );
}

export async function listRecentRefreshRuns(limit = 10): Promise<RefreshRun[]> {
  return query<RefreshRun>("select * from public.refresh_runs order by created_at desc limit $1", [limit]);
}
