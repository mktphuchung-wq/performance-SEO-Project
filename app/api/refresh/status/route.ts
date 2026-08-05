import { NextResponse } from "next/server";
import { getRefreshRun, listRecentRefreshRuns } from "@/lib/repositories/refresh-runs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    const run = await getRefreshRun(id);
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ run });
  }

  const runs = await listRecentRefreshRuns(10);
  return NextResponse.json({ runs });
}
