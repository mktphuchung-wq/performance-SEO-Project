import { after, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { runSyncJob } from "@/lib/sync/sheet";
import { ActiveSyncRunError, enqueueSyncRun, listRecentSyncRuns } from "@/lib/repositories/sync-runs";

export const maxDuration = 300;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "No Google access token on session. Please sign in again." }, { status: 401 });
  }

  try {
    const run = await enqueueSyncRun(session.user?.email ?? null);
    const accessToken = session.accessToken;
    after(async () => {
      try {
        await runSyncJob(run.id, accessToken);
      } catch (error) {
        console.error(`Sync job ${run.id} failed`, error);
      }
    });
    return NextResponse.json({ runId: run.id, status: run.status }, { status: 202 });
  } catch (error) {
    if (error instanceof ActiveSyncRunError) {
      return NextResponse.json({ error: error.message, runId: error.runId }, { status: 409 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function GET() {
  const runs = await listRecentSyncRuns(10);
  return NextResponse.json({ runs });
}
