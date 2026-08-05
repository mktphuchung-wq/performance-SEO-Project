import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { listPerformanceByMemberEmail } from "@/lib/repositories/performance-cache";
import type { RangeKey } from "@/lib/ranges";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rangeKey = (searchParams.get("range") as RangeKey) || "current_month";

  const rows = await listPerformanceByMemberEmail(session.user.email, rangeKey);
  return NextResponse.json({ rows });
}
