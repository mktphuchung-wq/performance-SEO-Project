import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { processNextRefreshItem } from "@/lib/performance/refresh";
import { finishRefreshRun } from "@/lib/repositories/refresh-runs";

export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "No Google access token on session. Please sign in again." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const refreshRunId = body.refreshRunId as string;
  if (!refreshRunId) {
    return NextResponse.json({ error: "refreshRunId is required" }, { status: 400 });
  }

  try {
    const result = await processNextRefreshItem(session.accessToken, refreshRunId);
    return NextResponse.json(result);
  } catch (error) {
    await finishRefreshRun(refreshRunId, "failed", (error as Error).message).catch(() => undefined);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
