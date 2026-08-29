import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { runMonthlySnapshot } from "@/lib/performance/monthly-snapshot";

export const maxDuration = 300;

/** Search Console keeps about sixteen months, so asking for more just wastes calls. */
const MAX_MONTHS_PER_CALL = 16;

/**
 * Records closed calendar months into the baseline history and flags the odd ones
 * as they land. Chunkable via `months` + `endingBefore` so a backfill can be run
 * a few months at a time inside the request budget.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "No Google access token on session. Please sign in again." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const months = Number(body.months ?? 1);
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS_PER_CALL) {
    return NextResponse.json({ error: `months must be an integer between 1 and ${MAX_MONTHS_PER_CALL}` }, { status: 400 });
  }
  const endingBefore = typeof body.endingBefore === "string" ? body.endingBefore : undefined;
  if (endingBefore && !/^\d{4}-\d{2}-\d{2}$/.test(endingBefore)) {
    return NextResponse.json({ error: "endingBefore must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    return NextResponse.json(await runMonthlySnapshot(session.accessToken, { months, endingBefore }));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
