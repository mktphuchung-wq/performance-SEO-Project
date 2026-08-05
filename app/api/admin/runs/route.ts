import { NextResponse } from "next/server";
import { listRecentSyncRuns } from "@/lib/repositories/sync-runs";
import { listRecentRefreshRuns } from "@/lib/repositories/refresh-runs";
import { getRangeFreshness } from "@/lib/repositories/performance-cache";

export async function GET() {
  const [syncRuns, refreshRuns, freshness] = await Promise.all([
    listRecentSyncRuns(15),
    listRecentRefreshRuns(15),
    getRangeFreshness(),
  ]);

  return NextResponse.json({ syncRuns, refreshRuns, freshness });
}
