import { NextResponse } from "next/server";
import { listDistinctMembers, listDistinctProjects } from "@/lib/repositories/content-urls";
import { listPerformanceAll } from "@/lib/repositories/performance-cache";
import type { RangeKey } from "@/lib/ranges";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rangeKey = (searchParams.get("range") as RangeKey) || "current_month";
  const project = searchParams.get("project") ?? undefined;
  const memberName = searchParams.get("member") ?? undefined;

  const [rows, members, projects] = await Promise.all([
    listPerformanceAll(rangeKey, { project, memberName }),
    listDistinctMembers(),
    listDistinctProjects(),
  ]);

  return NextResponse.json({ rows, members, projects });
}
