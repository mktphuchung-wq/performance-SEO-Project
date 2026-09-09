import { query, queryOne, type DbExecutor } from "@/lib/db";

export interface ContentUrl {
  id: string;
  url_hash: string;
  content_hash: string | null;
  project: string;
  url: string;
  member_name: string;
  member_email: string | null;
  work_type: string;
  gsc_property: string | null;
  is_active: boolean;
  /** The most recent work event on this URL. "Who owns it now", not "when it went live". */
  worked_at: string | null;
  /**
   * The earliest work event on this URL, of any kind. Display only — it says when
   * the team started working on the URL, and never gates data the way
   * published_at does.
   */
  first_worked_at: string | null;
  /**
   * When a work event said this URL was created. Null when no such event exists,
   * which reads as "already live" — the only date allowed to gate GSC data.
   */
  published_at: string | null;
  kpi_excluded: boolean;
  kpi_excluded_reason: string | null;
  kpi_excluded_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface UpsertContentUrlInput {
  urlHash: string;
  project: string;
  url: string;
  memberName: string;
  memberEmail: string | null;
  workType: string;
  gscProperty: string | null;
  workedAt: string | null;
  firstWorkedAt: string | null;
  publishedAt: string | null;
  sourceRowNumber: number | null;
}

export interface BulkUpsertContentUrlInput extends UpsertContentUrlInput {
  contentHash: string;
}

function executorQuery<T extends Record<string, unknown>>(db: DbExecutor | undefined, text: string, params?: unknown[]) {
  return db ? db.query<T>(text, params).then((result) => result.rows) : query<T>(text, params);
}

export async function getContentHashMap(db?: DbExecutor): Promise<Map<string, { contentHash: string | null; isActive: boolean }>> {
  const rows = await executorQuery<{ url_hash: string; content_hash: string | null; is_active: boolean }>(
    db,
    "select url_hash, content_hash, is_active from public.content_urls",
  );
  return new Map(rows.map((row) => [row.url_hash, { contentHash: row.content_hash, isActive: row.is_active }]));
}

export async function bulkUpsertContentUrls(rows: BulkUpsertContentUrlInput[], db?: DbExecutor): Promise<void> {
  if (rows.length === 0) return;
  await executorQuery(
    db,
    `insert into public.content_urls
       (url_hash, content_hash, project, url, member_name, member_email, work_type, gsc_property,
        worked_at, first_worked_at, published_at, source_row_number, is_active, last_seen_at, updated_at)
     select x.url_hash, x.content_hash, x.project, x.url, x.member_name, x.member_email, x.work_type,
            mapping.gsc_property, x.worked_at, x.first_worked_at, x.published_at, x.source_row_number, true, now(), now()
     from jsonb_to_recordset($1::jsonb) as x(
       url_hash text, content_hash text, project text, url text, member_name text, member_email text,
       work_type text, gsc_property text, worked_at date, first_worked_at date, published_at date,
       source_row_number integer
     ) left join public.project_gsc_properties mapping on mapping.project = x.project
     on conflict (url_hash) do update set
       content_hash = excluded.content_hash,
       project = excluded.project,
       url = excluded.url,
       member_name = excluded.member_name,
       member_email = excluded.member_email,
       work_type = excluded.work_type,
       gsc_property = excluded.gsc_property,
       worked_at = excluded.worked_at,
       first_worked_at = excluded.first_worked_at,
       published_at = excluded.published_at,
       source_row_number = excluded.source_row_number,
       is_active = true,
       last_seen_at = now(),
       updated_at = now()`,
    [JSON.stringify(rows.map((row) => ({
      url_hash: row.urlHash,
      content_hash: row.contentHash,
      project: row.project,
      url: row.url,
      member_name: row.memberName,
      member_email: row.memberEmail,
      work_type: row.workType,
      gsc_property: row.gscProperty,
      worked_at: row.workedAt,
      first_worked_at: row.firstWorkedAt,
      published_at: row.publishedAt,
      source_row_number: row.sourceRowNumber,
    })))],
  );
}

export async function upsertContentUrl(input: UpsertContentUrlInput): Promise<{ id: string; inserted: boolean }> {
  const row = await queryOne<{ id: string; inserted: boolean }>(
    `insert into public.content_urls
       (url_hash, project, url, member_name, member_email, work_type, gsc_property, worked_at, first_worked_at, published_at, source_row_number, is_active, last_seen_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, now(), now())
     on conflict (url_hash) do update set
       project = excluded.project,
       url = excluded.url,
       member_name = excluded.member_name,
       member_email = excluded.member_email,
       work_type = excluded.work_type,
       gsc_property = excluded.gsc_property,
       worked_at = excluded.worked_at,
       first_worked_at = excluded.first_worked_at,
       published_at = excluded.published_at,
       source_row_number = excluded.source_row_number,
       is_active = true,
       last_seen_at = now(),
       updated_at = now()
     returning id, (xmax = 0) as inserted`,
    [
      input.urlHash,
      input.project,
      input.url,
      input.memberName,
      input.memberEmail,
      input.workType,
      input.gscProperty,
      input.workedAt,
      input.firstWorkedAt,
      input.publishedAt,
      input.sourceRowNumber,
    ],
  );
  if (!row) throw new Error("Failed to upsert content_url");
  return row;
}

/**
 * Manually take a URL in or out of KPI scoring. Deliberately manual — there is
 * no automatic seasonality detection; an admin decides that a holiday page is
 * far enough out of season to stop counting against its owner.
 */
export async function setKpiExclusion(id: string, excluded: boolean, reason: string | null): Promise<void> {
  await query(
    `update public.content_urls
     set kpi_excluded = $2,
         kpi_excluded_reason = case when $2 then $3 else null end,
         kpi_excluded_at = case when $2 then now() else null end,
         updated_at = now()
     where id = $1`,
    [id, excluded, reason],
  );
}

export async function deactivateMissingContentUrls(seenHashes: string[], db?: DbExecutor): Promise<number> {
  if (seenHashes.length === 0) {
    const rows = await executorQuery<{ id: string }>(
      db,
      "update public.content_urls set is_active = false, updated_at = now() where is_active = true returning id",
    );
    return rows.length;
  }
  const rows = await executorQuery<{ id: string }>(
    db,
    `update public.content_urls
     set is_active = false, updated_at = now()
     where is_active = true and url_hash <> all($1::text[])
     returning id`,
    [seenHashes],
  );
  return rows.length;
}

export async function listActiveContentUrls(): Promise<ContentUrl[]> {
  return query<ContentUrl>("select * from public.content_urls where is_active = true order by project, member_name");
}

export async function listContentUrlsByMemberEmail(email: string): Promise<ContentUrl[]> {
  return query<ContentUrl>(
    "select * from public.content_urls where is_active = true and lower(member_email) = lower($1) order by worked_at desc nulls last",
    [email],
  );
}

export async function listAllContentUrls(filters: { project?: string; memberName?: string; isActive?: boolean }): Promise<ContentUrl[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.project) {
    params.push(filters.project);
    conditions.push(`project = $${params.length}`);
  }
  if (filters.memberName) {
    params.push(filters.memberName);
    conditions.push(`member_name = $${params.length}`);
  }
  if (filters.isActive !== undefined) {
    params.push(filters.isActive);
    conditions.push(`is_active = $${params.length}`);
  }

  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  return query<ContentUrl>(`select * from public.content_urls ${where} order by project, member_name`, params);
}

export async function getContentUrlById(id: string): Promise<ContentUrl | null> {
  return queryOne<ContentUrl>("select * from public.content_urls where id = $1", [id]);
}

export async function listContentUrlsByIds(ids: string[]): Promise<ContentUrl[]> {
  if (ids.length === 0) return [];
  return query<ContentUrl>("select * from public.content_urls where id = any($1::uuid[])", [ids]);
}

export async function listActiveContentUrlsByIds(ids: string[]): Promise<ContentUrl[]> {
  if (ids.length === 0) return [];
  return query<ContentUrl>("select * from public.content_urls where id = any($1::uuid[]) and is_active = true", [ids]);
}

export async function listContentUrlsMissingGscProperty(): Promise<ContentUrl[]> {
  return query<ContentUrl>(
    "select * from public.content_urls where is_active = true and (gsc_property is null or gsc_property = '') order by project, member_name",
  );
}

export async function listContentUrlsMissingMemberEmail(): Promise<ContentUrl[]> {
  return query<ContentUrl>(
    "select * from public.content_urls where is_active = true and (member_email is null or member_email = '') order by member_name, project",
  );
}

export async function listDistinctMembers(): Promise<string[]> {
  const rows = await query<{ member_name: string }>(
    "select distinct member_name from public.content_urls where is_active = true and member_name <> '' order by member_name",
  );
  return rows.map((row) => row.member_name);
}

export async function listDistinctProjects(): Promise<string[]> {
  const rows = await query<{ project: string }>(
    "select distinct project from public.content_urls where is_active = true and project <> '' order by project",
  );
  return rows.map((row) => row.project);
}
