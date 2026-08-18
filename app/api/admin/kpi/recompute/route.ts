import { NextResponse } from "next/server";
import { computeAndStoreScores } from "@/lib/performance/refresh";
import { getRangeFreshness } from "@/lib/repositories/performance-cache";
import { SELECTABLE_RANGE_KEYS, isRollingRange } from "@/lib/ranges";

/**
 * Re-grade every scoreable range from the cache already in Postgres.
 *
 * Scoring never touches Search Console, so this is the cheap path after an admin
 * changes a project type, excludes a URL, or retunes kpi_settings — no need to
 * spend API quota on a full refresh just to see the new numbers.
 */
export async function POST() {
  // Date the scores by the window the cache actually measured, not by today's
  // rolling window — the cache may be days old, and a score row should say which
  // period it graded.
  const freshness = await getRangeFreshness();
  const windowByRange = new Map(freshness.map((f) => [f.range_key, f]));

  const recomputed: string[] = [];
  const skipped: string[] = [];

  for (const rangeKey of SELECTABLE_RANGE_KEYS.filter(isRollingRange)) {
    const window = windowByRange.get(rangeKey);
    if (!window?.start_date || !window.end_date) {
      // Never refreshed, so there is nothing cached to grade.
      skipped.push(rangeKey);
      continue;
    }
    await computeAndStoreScores(rangeKey, window.start_date, window.end_date);
    recomputed.push(rangeKey);
  }

  return NextResponse.json({ ok: true, recomputed, skipped });
}
