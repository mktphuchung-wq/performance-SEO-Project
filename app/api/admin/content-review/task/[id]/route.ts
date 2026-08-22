import { NextResponse } from "next/server";
import { deleteTask, getTaskById, recomputeBatch, updateTaskNote } from "@/lib/repositories/content-review";

/**
 * The reviewer's note on one task — why a grade is what it is, in their own
 * words.
 *
 * No recompute follows. A note is not an input to the arithmetic, and running
 * the recompute anyway would suggest it might be, on every keystroke the UI
 * debounces.
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/content-review/task/[id]">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.note === undefined) {
    return NextResponse.json({ error: "note is required" }, { status: 400 });
  }
  if (typeof body.note !== "string") {
    return NextResponse.json({ error: "note must be text" }, { status: 400 });
  }

  const task = await updateTaskNote(id, body.note);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, task });
}

/**
 * Removes one pasted row. The grades on it go with it (cascade in migration
 * 007), and the batch is rebuilt straight away — a deleted task changes both the
 * quality average and the count it was part of.
 */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/admin/content-review/task/[id]">) {
  const { id } = await ctx.params;

  const task = await getTaskById(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  await deleteTask(id);
  const batch = await recomputeBatch(task.batch_id);

  return NextResponse.json({ ok: true, batch });
}
