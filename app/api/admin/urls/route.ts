import { NextResponse } from "next/server";
import { normalizeMonth } from "@/lib/content-review/month";
import { listDistinctMembers, listDistinctProjects } from "@/lib/repositories/content-urls";
import { listPerformanceAll } from "@/lib/repositories/performance-cache";
import { computeRangeDates, DEFAULT_RANGE_KEY, type RangeKey } from "@/lib/ranges";

/** Last day of the calendar month starting at `monthStart` (YYYY-MM-01). */
function monthEnd(monthStart: string): string {
  const start = new Date(`${monthStart}T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

/**
 * The URL listing behind Admin → URLs.
 *
 * Two windows are in play and they are not the same thing:
 *  - `range` picks which cached Search Console figures are shown. Only the
 *    refreshed ranges have any, so it stays a range key.
 *  - `month` (optional) narrows *which URLs are listed* to the ones worked on in
 *    that calendar month, which is how a period gets credited to the person who
 *    worked it. It never changes the metrics.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rangeKey = (searchParams.get("range") as RangeKey) || DEFAULT_RANGE_KEY;
  const project = searchParams.get("project") ?? undefined;
  const memberName = searchParams.get("member") ?? undefined;
  const workedInPeriodOnly = searchParams.get("workedOnly") === "1";

  const month = normalizeMonth(searchParams.get("month"));
  let startDate: string | undefined;
  let endDate: string | undefined;
  if (month) {
    startDate = month;
    endDate = monthEnd(month);
  } else {
    // all_time has a window too, so attribution still works there; only a range
    // we cannot date at all would leave these undefined.
    try {
      const dates = computeRangeDates(rangeKey);
      startDate = dates.startDate;
      endDate = dates.endDate;
    } catch {
      startDate = undefined;
      endDate = undefined;
    }
  }

  const [rows, members, projects] = await Promise.all([
    listPerformanceAll(rangeKey, { project, memberName, startDate, endDate, workedInPeriodOnly }),
    listDistinctMembers(),
    listDistinctProjects(),
  ]);

  return NextResponse.json({ rows, members, projects, startDate, endDate });
}
