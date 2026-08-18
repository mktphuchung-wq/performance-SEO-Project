import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { syncContentUrlsFromSheet } from "@/lib/sync/sheet";
import { listRecentSyncRuns } from "@/lib/repositories/sync-runs";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "No Google access token on session. Please sign in again." }, { status: 401 });
  }

  try {
    const result = await syncContentUrlsFromSheet(session.accessToken, session.user?.email ?? null);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function GET() {
  const runs = await listRecentSyncRuns(10);
  return NextResponse.json({ runs });
}
