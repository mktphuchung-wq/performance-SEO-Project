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

export async function upsertMemberAlias(memberName: string, memberEmail: string): Promise<void> {
  await query(
    `insert into public.member_aliases (member_name, member_email)
     values ($1, $2)
     on conflict (member_name) do update set member_email = excluded.member_email, updated_at = now()`,
    [memberName, memberEmail.toLowerCase()],
  );
}

export async function deleteMemberAlias(memberName: string): Promise<void> {
  await query("delete from public.member_aliases where member_name = $1", [memberName]);
}
