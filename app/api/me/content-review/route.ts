import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getMemberNameByEmail } from "@/lib/repositories/member-aliases";
import { listBatchesByMember } from "@/lib/repositories/content-review";

/**
 * A member reading their own Content KPI, month by month, read-only.
 *
 * /api/me is only gated on being signed in, so ownership is checked here — the
 * session email is resolved to a Sheet name and only that name is queried. There
 * is deliberately no "admin views another member" branch: admins have the full
 * review screen, and leaving the branch out means this route can never serve one
 * person another person data.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memberName = await getMemberNameByEmail(session.user.email);

  // No mapping is not an error — it means nobody has reviewed work under this
  // account yet. An empty list says that without inventing a zero.
  if (!memberName) {
    return NextResponse.json({ memberName: null, batches: [] });
  }

  const batches = await listBatchesByMember(memberName);
  return NextResponse.json({ memberName, batches });
}
