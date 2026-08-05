import { NextResponse } from "next/server";
import {
  deleteMemberAlias,
  listMemberAliases,
  upsertMemberAlias,
} from "@/lib/repositories/member-aliases";
import { listDistinctMembers } from "@/lib/repositories/content-urls";

export async function GET() {
  const [aliases, memberNames] = await Promise.all([listMemberAliases(), listDistinctMembers()]);
  return NextResponse.json({ aliases, memberNames });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const memberName = String(body.memberName ?? "").trim();
  const memberEmail = String(body.memberEmail ?? "").trim();

  if (!memberName || !memberEmail) {
    return NextResponse.json({ error: "memberName and memberEmail are required" }, { status: 400 });
  }

  await upsertMemberAlias(memberName, memberEmail);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const memberName = searchParams.get("memberName");
  if (!memberName) {
    return NextResponse.json({ error: "memberName is required" }, { status: 400 });
  }
  await deleteMemberAlias(memberName);
  return NextResponse.json({ ok: true });
}
