import { NextResponse } from "next/server";
import { listMemberRollups } from "@/lib/repositories/rollups";
import type { RangeKey } from "@/lib/ranges";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rangeKey = (searchParams.get("range") as RangeKey) || "current_month";
  const rows = await listMemberRollups(rangeKey);
  return NextResponse.json({ rows });
}
