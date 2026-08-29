import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { evaluateWarningsForClosedMonth } from "@/lib/performance/warning-evaluation";
import { closedCalendarMonths } from "@/lib/ranges";

/**
 * Run the warning rules against the scores already in Postgres.
 *
 * Cheap and safe to press repeatedly: warnings are keyed to a closed calendar
 * month, so a second run inside the same month restates that month's findings
 * rather than piling up duplicates. Reads scores, never writes them.
 *
 * A refresh runs this automatically at the end of its publish; this exists so an
 * admin can re-evaluate after retuning a threshold without spending GSC quota.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const body = await req.json().catch(() => ({}));

  const evaluationMonth = (body as Record<string, unknown>).evaluationMonth;
  if (evaluationMonth !== undefined && evaluationMonth !== null) {
    if (typeof evaluationMonth !== "string" || !/^\d{4}-\d{2}-01$/.test(evaluationMonth)) {
      return NextResponse.json(
        { error: "evaluationMonth must be the first of a month (YYYY-MM-01)" },
        { status: 400 },
      );
    }
    // Evaluating a month that is not finished would grade a partial period and
    // then be overwritten by the complete one — the same mistake the closed-month
    // rule exists to avoid.
    const closed = closedCalendarMonths(1)[0]?.startDate;
    if (closed && evaluationMonth > closed) {
      return NextResponse.json(
        { error: `${evaluationMonth} has not closed yet — the latest closed month is ${closed}` },
        { status: 400 },
      );
    }
  }

  if (closedCalendarMonths(1).length === 0) {
    return NextResponse.json({ error: "No calendar month has closed yet" }, { status: 400 });
  }

  const result = await evaluateWarningsForClosedMonth({
    actorId: session?.user?.email ?? null,
    evaluationMonth: typeof evaluationMonth === "string" ? evaluationMonth : undefined,
  });

  return NextResponse.json({ ok: true, ...result });
}
