import { query, type DbExecutor } from "@/lib/db";
import { getSyncBulkChunkSize } from "@/lib/env";
import type { WorkKind } from "@/lib/sync/work-kind";

export interface ContentUrlWork {
  id: string;
  work_hash: string;
  content_hash: string | null;
  url_hash: string;
  content_url_id: string;
  project: string;
  member_name: string;
  member_email: string | null;
  work_type: string;
  work_kind: WorkKind;
  worked_at: string | null;
  source_row_number: number | null;
  is_active: boolean;
}

export interface BulkUpsertContentUrlWorkInput {
  workHash: string;
  contentHash: string;
  urlHash: string;
  project: string;
  memberName: string;
  memberEmail: string | null;
  workType: string;
  workKind: WorkKind;
  workedAt: string | null;
  sourceRowNumber: number | null;
}

function executorQuery<T extends Record<string, unknown>>(db: DbExecutor | undefined, text: string, params?: unknown[]) {
  return db ? db.query<T>(text, params).then((result) => result.rows) : query<T>(text, params);
}

export async function getWorkContentHashMap(db?: DbExecutor): Promise<Map<string, { contentHash: string | null; isActive: boolean }>> {
  const rows = await executorQuery<{ work_hash: string; content_hash: string | null; is_active: boolean }>(
    db,
    "select work_hash, content_hash, is_active from public.content_url_works",
  );
  return new Map(rows.map((row) => [row.work_hash, { contentHash: row.content_hash, isActive: row.is_active }]));
}

/**
 * content_url_id is resolved by joining url_hash rather than carried in the
 * payload: the caller upserts content_urls first in the same transaction, so the
 * join always finds the row and a brand-new URL needs no second round trip to
 * learn its id.
 *
 * The columns that make up work_hash (url_hash, worked_at, work_type,
 * member_name) cannot differ on conflict, so only the mutable half is written.
 */
export async function bulkUpsertContentUrlWorks(rows: BulkUpsertContentUrlWorkInput[], db?: DbExecutor): Promise<void> {
  if (rows.length === 0) return;
  const sql = `insert into public.content_url_works
       (work_hash, content_hash, url_hash, content_url_id, project, member_name, member_email,
        work_type, work_kind, worked_at, source_row_number, is_active, last_seen_at, updated_at)
     select x.work_hash, x.content_hash, x.url_hash, c.id, x.project, x.member_name, x.member_email,
            x.work_type, x.work_kind, x.worked_at, x.source_row_number, true, now(), now()
     from jsonb_to_recordset($1::jsonb) as x(
       work_hash text, content_hash text, url_hash text, project text, member_name text, member_email text,
       work_type text, work_kind text, worked_at date, source_row_number integer
     )
     join public.content_urls c on c.url_hash = x.url_hash
     on conflict (work_hash) do update set
       content_hash = excluded.content_hash,
       content_url_id = excluded.content_url_id,
       project = excluded.project,
       member_email = excluded.member_email,
       work_kind = excluded.work_kind,
       source_row_number = excluded.source_row_number,
       is_active = true,
       last_seen_at = now(),
       updated_at = now()`;
  const chunkSize = getSyncBulkChunkSize();
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const payload = rows.slice(offset, offset + chunkSize).map((row) => ({
      work_hash: row.workHash,
      content_hash: row.contentHash,
      url_hash: row.urlHash,
      project: row.project,
      member_name: row.memberName,
      member_email: row.memberEmail,
      work_type: row.workType,
      work_kind: row.workKind,
      worked_at: row.workedAt,
      source_row_number: row.sourceRowNumber,
    }));
    await executorQuery(db, sql, [JSON.stringify(payload)]);
  }
}

/**
 * A work event that left the Sheet is deactivated, never deleted: it still
 * explains a score that was already published for a past period.
 */
export async function deactivateMissingWorks(seenWorkHashes: string[], db?: DbExecutor): Promise<number> {
  if (seenWorkHashes.length === 0) {
    const rows = await executorQuery<{ id: string }>(
      db,
      "update public.content_url_works set is_active = false, updated_at = now() where is_active = true returning id",
    );
    return rows.length;
  }
  const rows = await executorQuery<{ id: string }>(
    db,
    `update public.content_url_works
     set is_active = false, updated_at = now()
     where is_active = true and work_hash <> all($1::text[])
     returning id`,
    [seenWorkHashes],
  );
  return rows.length;
}

export async function listWorksForContentUrl(contentUrlId: string): Promise<ContentUrlWork[]> {
  return query<ContentUrlWork>(
    `select * from public.content_url_works
     where content_url_id = $1 and is_active = true
     order by worked_at desc nulls last, source_row_number desc nulls last`,
    [contentUrlId],
  );
}

export interface UrlAttributionRow {
  content_url_id: string;
  member_name: string;
  member_email: string | null;
}

/**
 * Who a URL's performance counts for, in one window.
 *
 * A URL is credited to every member who has a work event inside the window —
 * both the writer and the auditor when both worked in the period, which is what
 * "impact in this period" means. A URL nobody touched in the window falls back
 * to its current owner, so long-lived content never becomes orphaned traffic
 * that counts for no one.
 *
 * One URL can therefore appear under several members. That double-counts on
 * purpose: it is per-member attribution, not a partition of the project total.
 */
export async function getUrlAttributionForRange(
  startDate: string,
  endDate: string,
  db?: DbExecutor,
): Promise<UrlAttributionRow[]> {
  const sql = `with in_window as (
      select distinct w.content_url_id, w.member_name, w.member_email
        from public.content_url_works w
       where w.is_active = true and w.worked_at between $1 and $2 and w.member_name <> ''
    )
    select c.id as content_url_id, i.member_name, i.member_email
      from public.content_urls c
      join in_window i on i.content_url_id = c.id
    union all
    select c.id as content_url_id, c.member_name, c.member_email
      from public.content_urls c
     where not exists (select 1 from in_window i where i.content_url_id = c.id)`;
  const params = [startDate, endDate];
  return db ? (await db.query<UrlAttributionRow>(sql, params)).rows : query<UrlAttributionRow>(sql, params);
}

/**
 * The same attribution rule as a SQL predicate, for queries that filter by
 * member instead of grouping by one. `urlId`, `start` and `end` are SQL
 * expressions from the surrounding query; `memberParam` is a placeholder like
 * "$3".
 */
export function memberAttributionPredicate(urlId: string, start: string, end: string, memberParam: string): string {
  return `(
    exists (select 1 from public.content_url_works w
             where w.content_url_id = ${urlId} and w.is_active = true
               and w.worked_at between ${start} and ${end} and w.member_name = ${memberParam})
    or (
      not exists (select 1 from public.content_url_works w
                   where w.content_url_id = ${urlId} and w.is_active = true
                     and w.worked_at between ${start} and ${end} and w.member_name <> '')
      and c.member_name = ${memberParam}
    )
  )`;
}
