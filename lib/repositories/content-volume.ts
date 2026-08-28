import { query } from "@/lib/db";

export interface ContentVolumeRow {
  key: string; // member_name or project
  /** The Sheet's "type" column verbatim — no enum is assumed on this side. */
  work_type: string;
  url_count: number;
}

/**
 * How much content was actually produced in the window, as opposed to how it
 * performed. Counts work events — one Sheet row each — whose date falls inside
 * the range.
 *
 * Counting events rather than URLs is what makes a month's number stable: a post
 * written in January stays counted in January even after someone audits the same
 * URL in August, and the August audit is counted in August. Both are real work.
 *
 * is_active here is the work event's, not the URL's: a row still in the Sheet
 * counts even if the URL itself was later dropped, because deleting a URL does
 * not undo the work done on it during the period. The score tables read only
 * active URLs — these two columns answer different questions, and the UI shows
 * them side by side for exactly that reason.
 */
export async function getContentVolumeByMember(startDate: string, endDate: string): Promise<ContentVolumeRow[]> {
  return query<ContentVolumeRow>(
    `select member_name as key,
            coalesce(nullif(trim(work_type), ''), '(unspecified)') as work_type,
            count(*)::int as url_count
     from public.content_url_works
     where is_active = true and worked_at is not null and worked_at between $1 and $2
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
     from public.content_url_works
     where is_active = true and worked_at is not null and worked_at between $1 and $2
     group by project, coalesce(nullif(trim(work_type), ''), '(unspecified)')
     order by project, work_type`,
    [startDate, endDate],
  );
}
