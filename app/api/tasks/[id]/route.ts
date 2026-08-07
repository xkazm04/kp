import { NextResponse } from "next/server";
import { getTask } from "@/app/_lib/db/tasks";
import { cancelTask } from "@/app/_lib/tasks";


export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  return NextResponse.json({ task });
}

// Cancel a running/queued task.
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ok = cancelTask(id);
  return NextResponse.json({ ok, task: getTask(id) });
}
