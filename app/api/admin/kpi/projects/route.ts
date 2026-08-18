import { NextResponse } from "next/server";
import { listProjectScores } from "@/lib/repositories/kpi-score-rollups";
import { DEFAULT_RANGE_KEY, type RangeKey } from "@/lib/ranges";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rangeKey = (searchParams.get("range") as RangeKey) || DEFAULT_RANGE_KEY;
  const rows = await listProjectScores(rangeKey);
  return NextResponse.json({ rows });
}
