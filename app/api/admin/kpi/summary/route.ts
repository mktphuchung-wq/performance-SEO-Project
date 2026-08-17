import { NextResponse } from "next/server";
import { listMemberScores, listProjectScores } from "@/lib/repositories/kpi-score-rollups";
import { listMemberRollups, listProjectRollups } from "@/lib/repositories/rollups";
import { getContentVolumeByMember, getContentVolumeByProject } from "@/lib/repositories/content-volume";
import { getRangeFreshness } from "@/lib/repositories/performance-cache";
import { computeRangeDates, DEFAULT_RANGE_KEY, RANGE_KEYS, type RangeKey } from "@/lib/ranges";

/**
 * Everything the KPI page shows for one range, in one request: the graded score,
 * the traffic it was graded from, and how much content was produced.
 *
 * The three arrays come back unjoined. They are joined on the client by
 * member/project name — a few dozen rows, where a hand-written join is easier to
 * read and change than a three-table SQL join with two outer sides.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requested = searchParams.get("range");
  const rangeKey: RangeKey =
    requested && (RANGE_KEYS as string[]).includes(requested) ? (requested as RangeKey) : DEFAULT_RANGE_KEY;
  const scope = searchParams.get("scope") === "project" ? "project" : "member";

  // Volume must be counted over the window the scores actually graded, which is
  // the window the cache holds — not today's rolling window, since the cache may
  // be days old. computeRangeDates only fills in when nothing is cached yet.
  const cached = (await getRangeFreshness()).find((f) => f.range_key === rangeKey);
  const fallback = rangeKey === "custom" ? null : computeRangeDates(rangeKey);
  const startDate = cached?.start_date ?? fallback?.startDate ?? null;
  const endDate = cached?.end_date ?? fallback?.endDate ?? null;

  const volumeOf = (by: (start: string, end: string) => Promise<unknown[]>) =>
    startDate && endDate ? by(startDate, endDate) : Promise.resolve([]);

  if (scope === "project") {
    const [scores, rollups, volume] = await Promise.all([
      listProjectScores(rangeKey),
      listProjectRollups(rangeKey),
      volumeOf(getContentVolumeByProject),
    ]);
    return NextResponse.json({ scope, rangeKey, startDate, endDate, scores, rollups, volume });
  }

  const [scores, rollups, volume] = await Promise.all([
    listMemberScores(rangeKey),
    listMemberRollups(rangeKey),
    volumeOf(getContentVolumeByMember),
  ]);
  return NextResponse.json({ scope, rangeKey, startDate, endDate, scores, rollups, volume });
}
