import { NextResponse } from "next/server";
import { listDistinctMembers, listDistinctProjects } from "@/lib/repositories/content-urls";
import { listPerformanceAll } from "@/lib/repositories/performance-cache";
import { DEFAULT_RANGE_KEY, type RangeKey } from "@/lib/ranges";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rangeKey = (searchParams.get("range") as RangeKey) || DEFAULT_RANGE_KEY;
  const project = searchParams.get("project") ?? undefined;
  const memberName = searchParams.get("member") ?? undefined;

  const [rows, members, projects] = await Promise.all([
    listPerformanceAll(rangeKey, { project, memberName }),
    listDistinctMembers(),
    listDistinctProjects(),
  ]);

  return NextResponse.json({ rows, members, projects });
}
