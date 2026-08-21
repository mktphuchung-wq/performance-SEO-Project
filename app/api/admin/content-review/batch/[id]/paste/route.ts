import { NextResponse } from "next/server";
import { parsePastedTasks } from "@/lib/content-review/parse-paste";
import {
  getBatchById,
  insertTasks,
  listScoresByBatch,
  listTasksByBatch,
  recomputeBatch,
} from "@/lib/repositories/content-review";

/**
 * Imports a clipboard block from the Sheet as tasks on this batch.
 *
 * Rows are appended, never replacing what is there: a month is usually pasted in
 * a few goes as work lands, and a paste that wiped the previous one would take
 * the grades already given with it.
 *
 * `dryRun` returns the same parse without writing, which is what the preview
 * step in the UI calls — the parser cannot tell a five-column paste from a
 * shifted eight-column one, so a human confirms the columns first.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/content-review/batch/[id]/paste">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const batch = await getBatchById(id);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const text = typeof body.text === "string" ? body.text : "";
  const parsed = parsePastedTasks(text);

  if (body.dryRun === true) {
    return NextResponse.json({ dryRun: true, rows: parsed.rows, warnings: parsed.warnings });
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json({ error: "Nothing to import — the pasted text has no rows." }, { status: 400 });
  }

  const inserted = await insertTasks(
    id,
    parsed.rows.map((row) => ({
      workedAt: row.workedAt,
      project: row.project,
      workType: row.workType,
      taskTitle: row.taskTitle,
      urls: row.urls,
      sourceRowNumber: row.sourceRowNumber,
    })),
  );

  const updated = await recomputeBatch(id);
  const [tasks, scores] = await Promise.all([listTasksByBatch(id), listScoresByBatch(id)]);

  return NextResponse.json({ inserted, warnings: parsed.warnings, batch: updated, tasks, scores });
}
