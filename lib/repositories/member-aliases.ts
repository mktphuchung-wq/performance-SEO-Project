import { query, type DbExecutor } from "@/lib/db";

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
export class MemberIdentityAmbiguityError extends Error {
  readonly email: string;
  readonly memberNames: string[];

  constructor(email: string, memberNames: string[]) {
    super(`Multiple canonical members are mapped to ${email}`);
    this.name = "MemberIdentityAmbiguityError";
    this.email = email;
    this.memberNames = memberNames;
  }
}

async function memberNamesForEmail(email: string, db?: DbExecutor): Promise<string[]> {
  const run = async <T extends Record<string, unknown>>(text: string, params: unknown[]): Promise<T[]> =>
    db ? (await db.query<T>(text, params)).rows : query<T>(text, params);
  const rows = await run<{ member_name: string }>(
    `select distinct member_name
       from public.member_aliases
      where lower(member_email) = lower($1) and member_name <> ''
      order by member_name`,
    [email],
  );
  if (rows.length > 0) return rows.map((row) => row.member_name);

  const fallback = await run<{ member_name: string }>(
    `select distinct member_name
       from (
         select member_name
           from public.content_urls
          where lower(member_email) = lower($1) and member_name <> ''
         union
         select member_name
           from public.content_url_works
          where is_active = true and lower(member_email) = lower($1) and member_name <> ''
       ) names
      order by member_name`,
    [email],
  );
  return fallback.map((row) => row.member_name);
}

export async function getMemberNameByEmail(email: string, db?: DbExecutor): Promise<string | null> {
  const names = await memberNamesForEmail(email, db);
  if (names.length > 1) throw new MemberIdentityAmbiguityError(email, names);
  return names[0] ?? null;
}

export async function resolveMemberNameForReport(email: string, db?: DbExecutor): Promise<string | null> {
  return getMemberNameByEmail(email.trim().toLowerCase(), db);
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
