import { NextResponse } from "next/server";
import { getTask } from "@/app/_lib/db/tasks";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { cancelTask } from "@/app/_lib/tasks";


// One task by id — the full row, INCLUDING `params` and `result`, i.e. the whole
// input and output of an AI run (CV text, candidate reports, draft letters).
//
// TENANCY: both verbs resolve the caller's workspace and pass it to getTask, so a
// task belonging to another team reads as 404. That is not belt-and-braces: the
// id is not a secret. `llm_usage.request_id` IS the task id, `llm_usage` is
// deployment-global by design, and the Activity tab renders it — so every task id
// on the box is enumerable from the UI. Without this check, clicking any Activity
// row returned another team's run output, and DELETE on the same id cancelled
// their job. Ownership must be proven before cancelling, so the read comes first.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const task = getTask(id, await currentWorkspace());
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  return NextResponse.json({ task });
}

// Cancel a running/queued task.
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ws = await currentWorkspace();
  // Prove ownership BEFORE aborting: cancelTask works off the id alone (the runner
  // holds one abort registry for the whole process), so the tenant check has to
  // happen here or it does not happen at all.
  if (!getTask(id, ws)) return NextResponse.json({ error: "task not found" }, { status: 404 });
  const ok = cancelTask(id);
  return NextResponse.json({ ok, task: getTask(id, ws) });
}
