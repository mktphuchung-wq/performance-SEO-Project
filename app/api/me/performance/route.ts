import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getMemberRollupByEmail } from "@/lib/repositories/rollups";
import type { RangeKey } from "@/lib/ranges";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rangeKey = (searchParams.get("range") as RangeKey) || "current_month";

  const rollup = await getMemberRollupByEmail(session.user.email, rangeKey);
  return NextResponse.json({ rollup });
}
