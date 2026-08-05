import { query, queryOne } from "@/lib/db";

export interface SyncRun {
  id: string;
  source: string;
  status: "running" | "success" | "failed";
  total_rows: number;
  inserted_rows: number;
  updated_rows: number;
  deactivated_rows: number;
  failed_rows: number;
  triggered_by: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export async function createSyncRun(triggeredBy: string | null): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `insert into public.sync_runs (source, status, triggered_by)
     values ('google_sheet', 'running', $1)
     returning id`,
    [triggeredBy],
  );
  if (!row) throw new Error("Failed to create sync_run");
  return row.id;
}

export async function completeSyncRun(
  id: string,
  result: { totalRows: number; insertedRows: number; updatedRows: number; deactivatedRows: number; failedRows: number },
): Promise<void> {
  await query(
    `update public.sync_runs
     set status = 'success', total_rows = $2, inserted_rows = $3, updated_rows = $4, deactivated_rows = $5, failed_rows = $6, finished_at = now()
     where id = $1`,
    [id, result.totalRows, result.insertedRows, result.updatedRows, result.deactivatedRows, result.failedRows],
  );
}

export async function failSyncRun(id: string, errorMessage: string): Promise<void> {
  await query(
    "update public.sync_runs set status = 'failed', error_message = $2, finished_at = now() where id = $1",
    [id, errorMessage],
  );
}

export async function listRecentSyncRuns(limit = 10): Promise<SyncRun[]> {
  return query<SyncRun>("select * from public.sync_runs order by created_at desc limit $1", [limit]);
}
