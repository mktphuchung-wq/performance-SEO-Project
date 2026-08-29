import { NextResponse } from "next/server";
import type { WarningLevel, WarningRangeKey } from "@/lib/performance/warning";
import { listEvaluationMonths, listWarningQueue } from "@/lib/repositories/url-kpi-warnings";

const RANGES: WarningRangeKey[] = ["last_1_month", "last_3_months"];
const LEVELS: WarningLevel[] = ["early_warning", "mandatory_audit"];

/** The warning queue, ordered by KPI drag. Unknown filter values are ignored, not guessed at. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const rangeKey = params.get("range");
  const level = params.get("level");
  const evaluationMonth = params.get("month");

  const rows = await listWarningQueue({
    evaluationMonth: evaluationMonth && /^\d{4}-\d{2}-01$/.test(evaluationMonth) ? evaluationMonth : undefined,
    memberName: params.get("member") || undefined,
    project: params.get("project") || undefined,
    rangeKey: RANGES.includes(rangeKey as WarningRangeKey) ? (rangeKey as WarningRangeKey) : undefined,
    level: LEVELS.includes(level as WarningLevel) ? (level as WarningLevel) : undefined,
    openOnly: params.get("open") !== "false",
  });

  return NextResponse.json({ rows, months: await listEvaluationMonths() });
}
