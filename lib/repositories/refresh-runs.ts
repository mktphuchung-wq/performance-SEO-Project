import { randomUUID } from "node:crypto";
import { query, queryOne, tryTransactionAdvisoryLock, withTransaction, type DbExecutor } from "@/lib/db";
import { getSyncGscExactChunkSize, getSyncRefreshItemLeaseSeconds, getSyncStaleRunMinutes, isSyncGscWideQueryEnabled } from "@/lib/env";
import type { ContentUrl } from "@/lib/repositories/content-urls";
import type { RangeDates } from "@/lib/ranges";

const REFRESH_LOCK_KEY = 1380336466;

export class ActiveRefreshRunError extends Error {
  constructor(public readonly runId: string, public readonly rangeKey: string) {
    super(`A Search Console refresh is already queued or running for ${rangeKey}`);
  }
}

export type RefreshRunStatus = "queued" | "running" | "success" | "partial" | "failed" | "cancelled";
export type RefreshRunPhase =
  | "planning"
  | "fetching_current"
  | "fetching_previous"
  | "staging"
  | "publishing"
  | "rollup"
  | "scoring"
  | "completed";

export interface RefreshRun {
  id: string;
  status: RefreshRunStatus;
  phase: RefreshRunPhase;
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
  total_items: number;
  completed_items: number;
  retry_count: number;
  error_message: string | null;
  gsc_query_ms: number | null;
  db_write_ms: number | null;
  gsc_call_count: number;
  heartbeat_at: string;
  started_at: string;
  finished_at: string | null;
  created_at: string;
}

export interface RefreshRunItem {
  id: string;
  refresh_run_id: string;
  gsc_property: string | null;
  item_type: "property_wide" | "property_exact" | "internal";
  content_url_ids: string[];
  status: "queued" | "running" | "success" | "error";
  tracked_url_count: number;
  processed_url_count: number;
  attempt_count: number;
  next_attempt_at: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  api_call_count: number;
  retry_count: number;
  error_type: string | null;
  error_message: string | null;
}

interface PlannedItem {
  gscProperty: string | null;
  itemType: RefreshRunItem["item_type"];
  contentUrlIds: string[];
}

function planItems(urls: ContentUrl[]): PlannedItem[] {
  const byProperty = new Map<string, string[]>();
  const internal: string[] = [];
  for (const url of urls) {
    if (!url.gsc_property) {
      internal.push(url.id);
      continue;
    }
    const ids = byProperty.get(url.gsc_property) ?? [];
    ids.push(url.id);
    byProperty.set(url.gsc_property, ids);
  }
  const planned: PlannedItem[] = [];
  for (const [gscProperty, contentUrlIds] of byProperty) {
    if (isSyncGscWideQueryEnabled()) {
      planned.push({ gscProperty, itemType: "property_wide", contentUrlIds });
      continue;
    }
    const chunkSize = getSyncGscExactChunkSize();
    for (let offset = 0; offset < contentUrlIds.length; offset += chunkSize) {
      planned.push({ gscProperty, itemType: "property_exact", contentUrlIds: contentUrlIds.slice(offset, offset + chunkSize) });
    }
  }
  if (internal.length > 0) planned.unshift({ gscProperty: null, itemType: "internal", contentUrlIds: internal });
  return planned;
}

export async function createRefreshRun(
  triggeredBy: string | null,
  range: RangeDates,
  urls: ContentUrl[],
): Promise<RefreshRun> {
  return withTransaction(async (client) => {
    if (!(await tryTransactionAdvisoryLock(client, REFRESH_LOCK_KEY))) throw new Error("Could not acquire refresh enqueue lock");
    await client.query(
      `update public.refresh_runs set status = 'failed', error_message = 'Stale refresh run reaped',
         finished_at = now(), updated_at = now()
       where status in ('queued', 'running') and total_items = 0
         and heartbeat_at < now() - ($1 * interval '1 minute')`,
      [getSyncStaleRunMinutes()],
    );
    const active = await client.query<RefreshRun>(
      "select * from public.refresh_runs where status in ('queued', 'running') order by created_at desc limit 1",
    );
    if (active.rows[0]) throw new ActiveRefreshRunError(active.rows[0].id, active.rows[0].range_key);

    const planned = planItems(urls);
    const created = await client.query<RefreshRun>(
      `insert into public.refresh_runs
         (status, phase, triggered_by, range_key, start_date, end_date, previous_start_date, previous_end_date,
          total_urls, pending_content_url_ids, total_items, heartbeat_at)
       values ('queued', 'planning', $1, $2, $3, $4, $5, $6, $7, $8, $9, now()) returning *`,
      [triggeredBy, range.rangeKey, range.startDate, range.endDate, range.previousStartDate, range.previousEndDate,
        urls.length, urls.map((url) => url.id), planned.length],
    );
    const run = created.rows[0];
    if (planned.length > 0) {
      await client.query(
        `insert into public.refresh_run_items
           (refresh_run_id, gsc_property, item_type, content_url_ids, tracked_url_count)
         select $1, x.gsc_property, x.item_type, x.content_url_ids, cardinality(x.content_url_ids)
         from jsonb_to_recordset($2::jsonb) as x(gsc_property text, item_type text, content_url_ids uuid[])`,
        [run.id, JSON.stringify(planned.map((item) => ({
          gsc_property: item.gscProperty,
          item_type: item.itemType,
          content_url_ids: item.contentUrlIds,
        })))],
      );
    }
    return run;
  });
}

export async function getRefreshRun(id: string): Promise<RefreshRun | null> {
  return queryOne<RefreshRun>("select * from public.refresh_runs where id = $1", [id]);
}

export async function claimNextRefreshItem(runId: string): Promise<{ run: RefreshRun; item: RefreshRunItem; leaseOwner: string } | null> {
  const leaseOwner = randomUUID();
  return withTransaction(async (client) => {
    const runResult = await client.query<RefreshRun>("select * from public.refresh_runs where id = $1 for update", [runId]);
    const run = runResult.rows[0];
    if (!run || !["queued", "running"].includes(run.status)) return null;
    await client.query(
      `update public.refresh_run_items set status = 'queued', lease_owner = null, lease_until = null, updated_at = now()
       where refresh_run_id = $1 and status = 'running' and lease_until < now()`,
      [runId],
    );
    const inFlight = await client.query(
      `select id from public.refresh_run_items
       where refresh_run_id = $1 and status = 'running' and lease_until >= now() limit 1`,
      [runId],
    );
    if (inFlight.rows[0]) return null;
    const itemResult = await client.query<RefreshRunItem>(
      `select * from public.refresh_run_items
       where refresh_run_id = $1 and status = 'queued' and (next_attempt_at is null or next_attempt_at <= now())
       order by created_at for update skip locked limit 1`,
      [runId],
    );
    const item = itemResult.rows[0];
    if (!item) return null;
    const claimed = await client.query<RefreshRunItem>(
      `update public.refresh_run_items set status = 'running', attempt_count = attempt_count + 1,
         lease_owner = $2, lease_until = now() + ($3 * interval '1 second'),
         started_at = coalesce(started_at, now()), updated_at = now()
       where id = $1 returning *`,
      [item.id, leaseOwner, getSyncRefreshItemLeaseSeconds()],
    );
    const runUpdate = await client.query<RefreshRun>(
      `update public.refresh_runs set status = 'running', phase = 'fetching_current',
         started_at = coalesce(started_at, now()), heartbeat_at = now(), updated_at = now()
       where id = $1 returning *`,
      [runId],
    );
    return { run: runUpdate.rows[0], item: claimed.rows[0], leaseOwner };
  });
}

export async function deferRefreshItem(
  runId: string,
  itemId: string,
  leaseOwner: string,
  values: { apiCalls: number; retries: number; gscQueryMs: number; errorType: string; errorMessage: string; delaySeconds: number },
): Promise<void> {
  await withTransaction(async (client) => {
    const deferred = await client.query(
      `update public.refresh_run_items set status = 'queued', next_attempt_at = now() + ($4 * interval '1 second'),
         api_call_count = api_call_count + $5, retry_count = retry_count + $6,
         error_type = $7, error_message = $8, lease_owner = null, lease_until = null, updated_at = now()
       where id = $1 and refresh_run_id = $2 and lease_owner = $3 and status = 'running' returning id`,
      [itemId, runId, leaseOwner, Math.max(1, values.delaySeconds), values.apiCalls, values.retries,
        values.errorType, values.errorMessage],
    );
    if (deferred.rows.length !== 1) throw new Error("Refresh item lease was lost");
    await client.query(
      `update public.refresh_runs set retry_count = retry_count + $2,
         gsc_query_ms = coalesce(gsc_query_ms, 0) + $3, gsc_call_count = gsc_call_count + $4,
         heartbeat_at = now(), updated_at = now() where id = $1 and status = 'running'`,
      [runId, values.retries, values.gscQueryMs, values.apiCalls],
    );
  });
}

export async function heartbeatRefreshWork(runId: string, itemId: string, leaseOwner: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `update public.refresh_run_items set lease_until = now() + ($4 * interval '1 second'), updated_at = now()
       where id = $1 and refresh_run_id = $2 and lease_owner = $3 and status = 'running'`,
      [itemId, runId, leaseOwner, getSyncRefreshItemLeaseSeconds()],
    );
    await client.query(
      "update public.refresh_runs set heartbeat_at = now(), updated_at = now() where id = $1 and status = 'running'",
      [runId],
    );
  });
}

export async function completeRefreshItem(
  runId: string,
  itemId: string,
  leaseOwner: string,
  values: { contentUrlIds: string[]; processed: number; withData: number; noData: number; failed: number; apiCalls: number; retries: number; gscQueryMs: number; dbWriteMs: number; errorType?: string; errorMessage?: string },
  db?: DbExecutor,
): Promise<void> {
  const execute = async (executor: DbExecutor) => {
    const itemStatus = values.failed > 0 ? "error" : "success";
    const updated = await executor.query(
      `update public.refresh_run_items set status = $4, processed_url_count = $5, api_call_count = $6,
         retry_count = $7, error_type = $8, error_message = $9, lease_owner = null, lease_until = null,
         finished_at = now(), updated_at = now()
       where id = $1 and refresh_run_id = $2 and lease_owner = $3 and status = 'running' returning id`,
      [itemId, runId, leaseOwner, itemStatus, values.processed, values.apiCalls, values.retries,
        values.errorType ?? null, values.errorMessage ?? null],
    );
    if (updated.rows.length !== 1) throw new Error("Refresh item lease was lost");
    const runUpdate = await executor.query(
      `update public.refresh_runs set processed_urls = least(total_urls, processed_urls + $2),
         urls_with_data = urls_with_data + $3, no_data_urls = no_data_urls + $4, failed_urls = failed_urls + $5,
         pending_content_url_ids = array(select item from unnest(pending_content_url_ids) with ordinality as p(item, ord)
                                         where not (item = any($6::uuid[])) order by ord),
         completed_items = completed_items + 1, retry_count = retry_count + $7,
         gsc_query_ms = coalesce(gsc_query_ms, 0) + $8, db_write_ms = coalesce(db_write_ms, 0) + $9,
         gsc_call_count = gsc_call_count + $10, phase = 'staging', heartbeat_at = now(), updated_at = now()
       where id = $1 and status = 'running' returning id`,
      [runId, values.processed, values.withData, values.noData, values.failed,
        values.contentUrlIds,
        values.retries, values.gscQueryMs, values.dbWriteMs, values.apiCalls],
    );
    if (runUpdate.rows.length !== 1) throw new Error("refresh_run not found or no longer running");
  };
  if (db) await execute(db);
  else await withTransaction(execute);
}

export async function splitRefreshItemForExactFallback(
  runId: string,
  itemId: string,
  leaseOwner: string,
  chunks: string[][],
  values: { apiCalls: number; retries: number; gscQueryMs: number; errorType: string; errorMessage: string },
): Promise<void> {
  if (chunks.length === 0) throw new Error("Exact fallback requires at least one URL chunk");
  await withTransaction(async (client) => {
    const released = await client.query(
      `update public.refresh_run_items set status = 'error', processed_url_count = 0,
         api_call_count = $4, retry_count = $5, error_type = $6, error_message = $7,
         lease_owner = null, lease_until = null, finished_at = now(), updated_at = now()
       where id = $1 and refresh_run_id = $2 and lease_owner = $3 and status = 'running' returning id`,
      [itemId, runId, leaseOwner, values.apiCalls, values.retries, values.errorType, values.errorMessage],
    );
    if (released.rows.length !== 1) throw new Error("Refresh item lease was lost");
    await client.query(
      `insert into public.refresh_run_items
         (refresh_run_id, gsc_property, item_type, content_url_ids, tracked_url_count)
       select $1, source.gsc_property, 'property_exact', x.content_url_ids, cardinality(x.content_url_ids)
       from public.refresh_run_items source
       cross join jsonb_to_recordset($3::jsonb) as x(content_url_ids uuid[])
       where source.id = $2`,
      [runId, itemId, JSON.stringify(chunks.map((contentUrlIds) => ({ content_url_ids: contentUrlIds })))],
    );
    await client.query(
      `update public.refresh_runs set total_items = total_items - 1 + $2,
         retry_count = retry_count + $3, gsc_query_ms = coalesce(gsc_query_ms, 0) + $4,
         gsc_call_count = gsc_call_count + $5, phase = 'fetching_current', heartbeat_at = now(), updated_at = now()
       where id = $1 and status = 'running'`,
      [runId, chunks.length, values.retries, values.gscQueryMs, values.apiCalls],
    );
  });
}

export async function setRefreshPhase(id: string, phase: RefreshRunPhase, db?: DbExecutor): Promise<void> {
  const sql = "update public.refresh_runs set phase = $2, heartbeat_at = now(), updated_at = now() where id = $1 and status = 'running'";
  if (db) await db.query(sql, [id, phase]);
  else await query(sql, [id, phase]);
}

export async function finishRefreshRun(id: string, status: "success" | "partial" | "failed", errorMessage?: string, db?: DbExecutor): Promise<void> {
  const sql = `update public.refresh_runs set status = $2, phase = 'completed', error_message = $3,
       heartbeat_at = now(), finished_at = now(), updated_at = now()
     where id = $1 and status in ('queued', 'running')`;
  if (db) await db.query(sql, [id, status, errorMessage ?? null]);
  else await query(sql, [id, status, errorMessage ?? null]);
}

export async function listRecentRefreshRuns(limit = 10): Promise<RefreshRun[]> {
  return query<RefreshRun>("select * from public.refresh_runs order by created_at desc limit $1", [limit]);
}
