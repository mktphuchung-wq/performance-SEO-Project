import { query, queryOne, tryTransactionAdvisoryLock, withTransaction } from "@/lib/db";
import { getSyncStaleRunMinutes } from "@/lib/env";

const SYNC_LOCK_KEY = 1398361667;

export class ActiveSyncRunError extends Error {
  constructor(public readonly runId: string) {
    super("A Google Sheet sync is already queued or running");
  }
}

export interface SyncRun {
  id: string;
  source: string;
  status: "queued" | "running" | "success" | "failed";
  total_rows: number;
  inserted_rows: number;
  updated_rows: number;
  deactivated_rows: number;
  failed_rows: number;
  rows_skipped_unchanged: number;
  triggered_by: string | null;
  error_message: string | null;
  sheet_read_ms: number | null;
  db_write_ms: number | null;
  heartbeat_at: string;
  started_at: string;
  finished_at: string | null;
  created_at: string;
}

export async function enqueueSyncRun(triggeredBy: string | null): Promise<SyncRun> {
  return withTransaction(async (client) => {
    if (!(await tryTransactionAdvisoryLock(client, SYNC_LOCK_KEY))) throw new Error("Could not acquire sync enqueue lock");
    const staleMinutes = getSyncStaleRunMinutes();
    await client.query(
      `update public.sync_runs set status = 'failed', error_message = 'Stale sync run reaped', finished_at = now()
       where status in ('queued', 'running') and heartbeat_at < now() - ($1 * interval '1 minute')`,
      [staleMinutes],
    );
    const active = await client.query<SyncRun>(
      "select * from public.sync_runs where status in ('queued', 'running') order by created_at desc limit 1",
    );
    if (active.rows[0]) throw new ActiveSyncRunError(active.rows[0].id);
    const created = await client.query<SyncRun>(
      `insert into public.sync_runs (source, status, triggered_by, heartbeat_at)
       values ('google_sheet', 'queued', $1, now()) returning *`,
      [triggeredBy],
    );
    return created.rows[0];
  });
}

export async function claimSyncRun(id: string): Promise<boolean> {
  const rows = await query(
    `update public.sync_runs set status = 'running', started_at = now(), heartbeat_at = now()
     where id = $1 and status = 'queued' returning id`,
    [id],
  );
  return rows.length === 1;
}

export async function getSyncRun(id: string): Promise<SyncRun | null> {
  return queryOne<SyncRun>("select * from public.sync_runs where id = $1", [id]);
}

export async function heartbeatSyncRun(id: string): Promise<void> {
  await query("update public.sync_runs set heartbeat_at = now() where id = $1 and status = 'running'", [id]);
}

export async function completeSyncRun(id: string, result: {
  totalRows: number; insertedRows: number; updatedRows: number; deactivatedRows: number; failedRows: number;
  rowsSkippedUnchanged: number; sheetReadMs: number; dbWriteMs: number;
}): Promise<void> {
  await query(
    `update public.sync_runs set status = 'success', total_rows = $2, inserted_rows = $3,
       updated_rows = $4, deactivated_rows = $5, failed_rows = $6, rows_skipped_unchanged = $7,
       sheet_read_ms = $8, db_write_ms = $9, heartbeat_at = now(), finished_at = now()
     where id = $1 and status = 'running'`,
    [id, result.totalRows, result.insertedRows, result.updatedRows, result.deactivatedRows, result.failedRows,
      result.rowsSkippedUnchanged, result.sheetReadMs, result.dbWriteMs],
  );
}

export async function failSyncRun(id: string, errorMessage: string): Promise<void> {
  await query(
    `update public.sync_runs set status = 'failed', error_message = $2, heartbeat_at = now(), finished_at = now()
     where id = $1 and status in ('queued', 'running')`,
    [id, errorMessage],
  );
}

export async function listRecentSyncRuns(limit = 10): Promise<SyncRun[]> {
  return query<SyncRun>("select * from public.sync_runs order by created_at desc limit $1", [limit]);
}
