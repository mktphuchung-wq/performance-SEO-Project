import { NextResponse } from "next/server";
import { deleteTask, getTaskById, recomputeBatch } from "@/lib/repositories/content-review";

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
