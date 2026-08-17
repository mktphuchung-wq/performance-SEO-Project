import { query } from "@/lib/db";

export interface ContentVolumeRow {
  key: string; // member_name or project
  /** The Sheet's "type" column verbatim — no enum is assumed on this side. */
  work_type: string;
  url_count: number;
}

/**
 * How much content was actually produced in the window, as opposed to how it
 * performed. Counts URLs whose worked_at falls inside the range.
 *
 * is_active is deliberately not filtered on: a URL dropped from the Sheet later
 * does not undo the work done on it during the period. The score tables read
 * only active URLs — these two columns answer different questions, and the UI
 * shows them side by side for exactly that reason.
 */
export async function getContentVolumeByMember(startDate: string, endDate: string): Promise<ContentVolumeRow[]> {
  return query<ContentVolumeRow>(
    `select member_name as key,
            coalesce(nullif(trim(work_type), ''), '(unspecified)') as work_type,
            count(*)::int as url_count
     from public.content_urls
     where worked_at is not null and worked_at between $1 and $2
     group by member_name, coalesce(nullif(trim(work_type), ''), '(unspecified)')
     order by member_name, work_type`,
    [startDate, endDate],
  );
}

export async function getContentVolumeByProject(startDate: string, endDate: string): Promise<ContentVolumeRow[]> {
  return query<ContentVolumeRow>(
    `select project as key,
            coalesce(nullif(trim(work_type), ''), '(unspecified)') as work_type,
            count(*)::int as url_count
     from public.content_urls
     where worked_at is not null and worked_at between $1 and $2
     group by project, coalesce(nullif(trim(work_type), ''), '(unspecified)')
     order by project, work_type`,
    [startDate, endDate],
  );
}
