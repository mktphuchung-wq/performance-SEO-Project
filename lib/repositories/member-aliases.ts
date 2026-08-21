import { query } from "@/lib/db";

export interface MemberAlias {
  member_name: string;
  member_email: string;
}

export async function listMemberAliases(): Promise<MemberAlias[]> {
  return query<MemberAlias>("select member_name, member_email from public.member_aliases order by member_name");
}

export async function getEmailForMember(memberName: string): Promise<string | null> {
  const rows = await query<{ member_email: string }>(
    "select member_email from public.member_aliases where member_name = $1",
    [memberName],
  );
  return rows[0]?.member_email ?? null;
}

export async function getMemberAliasMap(): Promise<Map<string, string>> {
  const rows = await listMemberAliases();
  return new Map(rows.map((row) => [row.member_name, row.member_email]));
}

/**
 * The reverse lookup: which name in the Sheet is this signed-in person?
 *
 * Needed because tables keyed on identity-in-the-Sheet — member_kpi_weights,
 * content_review_batches — store member_name, while a session only ever carries
 * an email. The alias table is the mapping admins maintain, so it wins; the
 * fallback covers a member whose email reached content_urls through the Sheet
 * itself but who has no alias row yet.
 *
 * Returns null when nothing matches, which callers must read as "this person has
 * no work under review", not as an error.
 */
export async function getMemberNameByEmail(email: string): Promise<string | null> {
  const alias = await query<{ member_name: string }>(
    "select member_name from public.member_aliases where lower(member_email) = lower($1) order by member_name limit 1",
    [email],
  );
  if (alias[0]) return alias[0].member_name;

  const fromUrls = await query<{ member_name: string }>(
    `select member_name from public.content_urls
     where lower(member_email) = lower($1) and member_name <> ''
     order by member_name
     limit 1`,
    [email],
  );
  return fromUrls[0]?.member_name ?? null;
}

export async function upsertMemberAlias(memberName: string, memberEmail: string): Promise<void> {
  await query(
    `insert into public.member_aliases (member_name, member_email)
     values ($1, $2)
     on conflict (member_name) do update set member_email = excluded.member_email, updated_at = now()`,
    [memberName, memberEmail.toLowerCase()],
  );
  // Apply to URLs already synced, so admins don't have to re-sync the Sheet
  // after fixing a mapping.
  await query(
    `update public.content_urls
       set member_email = $2, updated_at = now()
     where member_name = $1 and member_email is distinct from $2`,
    [memberName, memberEmail.toLowerCase()],
  );
}

export async function deleteMemberAlias(memberName: string): Promise<void> {
  await query("delete from public.member_aliases where member_name = $1", [memberName]);
  await query(
    `update public.content_urls
       set member_email = null, updated_at = now()
     where member_name = $1 and member_email is not null`,
    [memberName],
  );
}
