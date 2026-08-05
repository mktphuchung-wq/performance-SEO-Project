import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { startRefresh } from "@/lib/performance/refresh";
import type { RangeKey } from "@/lib/ranges";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const rangeKey = body.rangeKey as RangeKey;
  const custom = body.startDate && body.endDate ? { startDate: body.startDate, endDate: body.endDate } : undefined;

  if (!rangeKey) {
    return NextResponse.json({ error: "rangeKey is required" }, { status: 400 });
  }

  try {
    const run = await startRefresh(session.user.email ?? null, rangeKey, custom);
    return NextResponse.json({ run });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
