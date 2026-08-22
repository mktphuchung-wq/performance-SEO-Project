import { NextResponse } from "next/server";
import { listReviewableMemberNames } from "@/lib/content-review/members";
import { currentMonthStart, previousMonthStart } from "@/lib/content-review/month";
import { getContentKpiSummary } from "@/lib/repositories/content-review";

/**
 * Content KPI for every member at once: this calendar month, last calendar
 * month, and the rolling three-month average.
 *
 * One endpoint feeds both summary cards (Admin → Members and Admin → KPI)
 * because they show the same three numbers. Splitting them would let the two
 * screens disagree about what "this month" means, which is exactly the confusion
 * a second KPI can least afford.
 *
 * There is no range parameter and there never will be: these are calendar
 * months, not the rolling 1M/3M/6M windows Official KPI is measured over, so the
 * RangeSwitcher on those pages has nothing to say about this table.
 */
export async function GET() {
  const memberNames = await listReviewableMemberNames();

  const thisMonth = currentMonthStart();
  const previousMonth = previousMonthStart();

  const rows = await getContentKpiSummary(memberNames, thisMonth, previousMonth);

  return NextResponse.json({ rows, thisMonth, previousMonth });
}
