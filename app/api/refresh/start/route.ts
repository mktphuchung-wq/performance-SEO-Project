import { after, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { drainRefreshRun, startRefresh } from "@/lib/performance/refresh";
import { ActiveRefreshRunError } from "@/lib/repositories/refresh-runs";
import { SELECTABLE_RANGE_KEYS, type RangeKey } from "@/lib/ranges";

export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.accessToken) {
    return NextResponse.json({ error: "No Google access token on session. Please sign in again." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const rangeKey = body.rangeKey as RangeKey;
  const custom = body.startDate && body.endDate ? { startDate: body.startDate, endDate: body.endDate } : undefined;

  if (!SELECTABLE_RANGE_KEYS.includes(rangeKey)) {
    return NextResponse.json({ error: "rangeKey is invalid" }, { status: 400 });
  }

  try {
    const run = await startRefresh(session.user.email ?? null, rangeKey, custom);
    const accessToken = session.accessToken;
    after(async () => {
      try {
        await drainRefreshRun(accessToken, run.id);
      } catch (error) {
        console.error(`Refresh job ${run.id} failed`, error);
      }
    });
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    if (error instanceof ActiveRefreshRunError) {
      return NextResponse.json({ error: error.message, runId: error.runId }, { status: 409 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
