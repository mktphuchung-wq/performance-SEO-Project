import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getMemberNameByEmail } from "@/lib/repositories/member-aliases";
import { listWarningsForMember } from "@/lib/repositories/url-kpi-warnings";

/**
 * A member's own warnings. Read-only: warnings are a request to look at a URL,
 * and nothing anyone does with them here changes their KPI.
 *
 * No member name mapped to the account means no work under review, which is an
 * empty list rather than an error — the same reading the rest of /api/me takes.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const memberName = await getMemberNameByEmail(email);
  if (!memberName) return NextResponse.json({ memberName: null, rows: [] });

  return NextResponse.json({ memberName, rows: await listWarningsForMember(memberName) });
}
