import { query, queryOne, tryTransactionAdvisoryLock, withTransaction, type DbExecutor } from "@/lib/db";
import { getSyncStaleRunMinutes } from "@/lib/env";
import type { RangeDates } from "@/lib/ranges";

const REFRESH_LOCK_KEY = 1380336466;

export class ActiveRefreshRunError extends Error {
  constructor(public readonly runId: string) {
    super("A Search Console refresh is already queued or running");
  }
}

export interface RefreshRun {
  id: string;
  status: "queued" | "running" | "success" | "failed";
  range_key: string;
  start_date: string;
  end_date: string;
  previous_start_date: string | null;
  previous_end_date: string | null;
  total_urls: number;
  processed_urls: number;
  urls_with_data: number;
  no_data_urls: number;
  failed_urls: number;
  pending_content_url_ids: string[];
  error_message: string | null;
  gsc_query_ms: number | null;
  db_write_ms: number | null;
  gsc_call_count: number;
  heartbeat_at: string;
  started_at: string;
  finished_at: string | null;
  created_at: string;
}

export async function createRefreshRun(
  triggeredBy: string | null,
  range: RangeDates,
  contentUrlIds: string[],
): Promise<RefreshRun> {
  return withTransaction(async (client) => {
    if (!(await tryTransactionAdvisoryLock(client, REFRESH_LOCK_KEY))) throw new Error("Could not acquire refresh enqueue lock");
    await client.query(
      `update public.refresh_runs set status = 'failed', error_message = 'Stale refresh run reaped', finished_at = now(), updated_at = now()
       where status in ('queued', 'running') and heartbeat_at < now() - ($1 * interval '1 minute')`,
      [getSyncStaleRunMinutes()],
    );
    const active = await client.query<RefreshRun>(
      "select * from public.refresh_runs where status in ('queued', 'running') order by created_at desc limit 1",
    );
    if (active.rows[0]) throw new ActiveRefreshRunError(active.rows[0].id);
    const result = await client.query<RefreshRun>(
      `insert into public.refresh_runs
         (status, triggered_by, range_key, start_date, end_date, previous_start_date, previous_end_date,
          total_urls, pending_content_url_ids, heartbeat_at)
       values ('queued', $1, $2, $3, $4, $5, $6, $7, $8, now()) returning *`,
      [triggeredBy, range.rangeKey, range.startDate, range.endDate, range.previousStartDate, range.previousEndDate,
        contentUrlIds.length, contentUrlIds],
    );
    return result.rows[0];
  });
}

export async function claimRefreshRun(id: string): Promise<boolean> {
  const rows = await query(
    `update public.refresh_runs set status = 'running', started_at = now(), heartbeat_at = now(), updated_at = now()
     where id = $1 and status = 'queued' returning id`,
    [id],
  );
  return rows.length === 1;
}

export async function getRefreshRun(id: string): Promise<RefreshRun | null> {
  return queryOne<RefreshRun>("select * from public.refresh_runs where id = $1", [id]);
}

export async function heartbeatRefreshRun(id: string): Promise<void> {
  await query("update public.refresh_runs set heartbeat_at = now(), updated_at = now() where id = $1 and status = 'running'", [id]);
}

export async function advanceRefreshRun(
  id: string,
  processedIds: string[],
  outcomeCounts: { withData: number; noData: number; failed: number },
  db?: DbExecutor,
): Promise<RefreshRun> {
  const sql = `update public.refresh_runs set processed_urls = processed_urls + $2, urls_with_data = urls_with_data + $3,
       no_data_urls = no_data_urls + $4, failed_urls = failed_urls + $5,
       pending_content_url_ids = array(select item from unnest(pending_content_url_ids) with ordinality as p(item, ord)
                                       where not (item = any($6::uuid[])) order by ord),
       heartbeat_at = now(), updated_at = now()
     where id = $1 and status = 'running' returning *`;
  const params = [id, processedIds.length, outcomeCounts.withData, outcomeCounts.noData, outcomeCounts.failed, processedIds];
  const row = db
    ? (await db.query<RefreshRun>(sql, params)).rows[0] ?? null
    : await queryOne<RefreshRun>(sql, params);
  if (!row) throw new Error("refresh_run not found or no longer running");
  return row;
}

export async function recordRefreshTimings(id: string, values: { gscQueryMs: number; dbWriteMs: number; gscCallCount: number }): Promise<void> {
  await query(
    `update public.refresh_runs set gsc_query_ms = coalesce(gsc_query_ms, 0) + $2,
       db_write_ms = coalesce(db_write_ms, 0) + $3, gsc_call_count = gsc_call_count + $4,
       heartbeat_at = now(), updated_at = now() where id = $1 and status = 'running'`,
    [id, values.gscQueryMs, values.dbWriteMs, values.gscCallCount],
  );
}

export async function finishRefreshRun(id: string, status: "success" | "failed", errorMessage?: string): Promise<void> {
  await query(
    `update public.refresh_runs set status = $2, error_message = $3, heartbeat_at = now(), finished_at = now(), updated_at = now()
     where id = $1 and status in ('queued', 'running')`,
    [id, status, errorMessage ?? null],
  );
}

export async function listRecentRefreshRuns(limit = 10): Promise<RefreshRun[]> {
  return query<RefreshRun>("select * from public.refresh_runs order by created_at desc limit $1", [limit]);
}
