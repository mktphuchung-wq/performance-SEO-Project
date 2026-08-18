import { NextResponse } from "next/server";
import { listContentUrlsMissingGscProperty, listContentUrlsMissingMemberEmail } from "@/lib/repositories/content-urls";
import { listRecentSyncRuns } from "@/lib/repositories/sync-runs";
import { listRecentRefreshRuns } from "@/lib/repositories/refresh-runs";

export async function GET() {
  const [missingGscProperty, missingMemberEmail, syncRuns, refreshRuns] = await Promise.all([
    listContentUrlsMissingGscProperty(),
    listContentUrlsMissingMemberEmail(),
    listRecentSyncRuns(5),
    listRecentRefreshRuns(5),
  ]);

  return NextResponse.json({
    missingGscProperty,
    missingMemberEmail,
    recentSyncRuns: syncRuns,
    recentRefreshRuns: refreshRuns,
  });
}
