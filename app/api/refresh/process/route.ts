import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { processRefreshBatch } from "@/lib/performance/refresh";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "No Google access token on session. Please sign in again." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const refreshRunId = body.refreshRunId as string;
  const batchSize = Number(body.batchSize) || 20;

  if (!refreshRunId) {
    return NextResponse.json({ error: "refreshRunId is required" }, { status: 400 });
  }

  try {
    const run = await processRefreshBatch(session.accessToken, refreshRunId, batchSize);
    return NextResponse.json({ run, done: run.status !== "running" });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
