import { NextResponse } from "next/server";
import { getSyncRun, listRecentSyncRuns } from "@/lib/repositories/sync-runs";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    const runs = await listRecentSyncRuns(10);
    return NextResponse.json({ runs });
  }
  const run = await getSyncRun(id);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ run });
}
