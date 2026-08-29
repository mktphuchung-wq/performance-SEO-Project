import { NextResponse } from "next/server";
import {
  getBatchById,
  insertTasks,
  listScoresByBatch,
  listTasksByBatch,
  recomputeBatch,
} from "@/lib/repositories/content-review";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Adds one task by hand.
 *
 * Everything else in a month is generated from the Sheet, so this is the escape
 * hatch for work the Sheet does not have — usually a piece with no URL yet. It
 * carries no work id, which is what keeps the generator from ever updating or
 * removing it.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/content-review/batch/[id]/task">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const batch = await getBatchById(id);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const taskTitle = text(body.taskTitle);
  const urls = text(body.urls);
  if (!taskTitle && !urls) {
    return NextResponse.json({ error: "A task needs at least a title or a URL." }, { status: 400 });
  }

  const workedAtRaw = text(body.workedAt);
  if (workedAtRaw && !ISO_DATE.test(workedAtRaw)) {
    return NextResponse.json({ error: "The date has to be a calendar date." }, { status: 400 });
  }

  await insertTasks(id, [
    {
      workedAt: workedAtRaw || null,
      project: text(body.project),
      workType: text(body.workType),
      taskTitle,
      urls,
      sourceRowNumber: null,
    },
  ]);

  const updated = (await recomputeBatch(id)) ?? batch;
  const [tasks, scores] = await Promise.all([listTasksByBatch(id), listScoresByBatch(id)]);

  return NextResponse.json({ batch: updated, tasks, scores });
}
