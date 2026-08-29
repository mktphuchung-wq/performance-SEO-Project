import type { UrlAttributionRow } from "@/lib/repositories/content-url-works";

/**
 * Who each URL counts for in a window, indexed by URL. A URL can land under more
 * than one member — see getUrlAttributionForRange.
 *
 * Lifted out of refresh.ts because three callers now need the identical fan-out:
 * the traffic rollups, the score aggregation, and the warning evaluator. A
 * warning that credited a URL to a different set of members than the score did
 * would be pointing at the wrong people.
 */
export function attributionIndex(rows: UrlAttributionRow[]): Map<string, UrlAttributionRow[]> {
  const index = new Map<string, UrlAttributionRow[]>();
  for (const row of rows) {
    const owners = index.get(row.content_url_id);
    if (owners) owners.push(row);
    else index.set(row.content_url_id, [row]);
  }
  return index;
}

/**
 * Fan one URL's row out to every member credited with it. Falls back to the
 * URL's own member so a row can never be dropped for lack of an attribution
 * entry, whatever the state of the work log.
 */
export function ownersOf(
  index: Map<string, UrlAttributionRow[]>,
  row: { content_url_id: string; member_name: string; member_email: string | null },
): UrlAttributionRow[] {
  return index.get(row.content_url_id) ?? [
    { content_url_id: row.content_url_id, member_name: row.member_name, member_email: row.member_email },
  ];
}

/** The key a member is stored under everywhere: their name, or the shared unassigned bucket. */
export function memberKeyOf(memberName: string): string {
  return memberName || "(unassigned)";
}

export interface MemberGrouping<T> {
  byMember: Map<string, T[]>;
  memberEmails: Map<string, string | null>;
  byProject: Map<string, T[]>;
}

/**
 * Group scored rows by member and by project in one pass, applying the
 * attribution fan-out. Members can share an item; projects cannot.
 */
export function groupByMemberAndProject<T>(
  items: T[],
  index: Map<string, UrlAttributionRow[]>,
  rowOf: (item: T) => { content_url_id: string; project: string; member_name: string; member_email: string | null },
): MemberGrouping<T> {
  const byMember = new Map<string, T[]>();
  const memberEmails = new Map<string, string | null>();
  const byProject = new Map<string, T[]>();

  for (const item of items) {
    const row = rowOf(item);
    const projectKey = row.project || "(unassigned)";
    if (!byProject.has(projectKey)) byProject.set(projectKey, []);
    byProject.get(projectKey)!.push(item);

    for (const owner of ownersOf(index, row)) {
      const memberKey = memberKeyOf(owner.member_name);
      if (!byMember.has(memberKey)) byMember.set(memberKey, []);
      byMember.get(memberKey)!.push(item);
      if (!memberEmails.get(memberKey)) memberEmails.set(memberKey, owner.member_email);
    }
  }

  return { byMember, memberEmails, byProject };
}
