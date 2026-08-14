import { NextResponse } from "next/server";
import { getTask } from "@/app/_lib/db/tasks";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { isKnownKind, startTask } from "@/app/_lib/tasks";


// DATA1 — one-click replay of a dead task. `params_json` is the exact request
// that was originally submitted, durably persisted on every row, so a retry is
// just `startTask(kind, params)` run server-side — the (potentially multi-MB)
// params never round-trip through the client. Replayability was verified
// per-kind: every handler's params are self-contained (inline text/objects) or
// DB-keyed (entryId / submissionId / lifecycleId / repoRef) — nothing
// references per-run temp files (analyze spills to a workdir at RUN time, not
// in params). `buildDedupeKey` makes a double-click merge into the in-flight
// run instead of duplicating it.
const RETRYABLE = new Set(["failed", "interrupted", "canceled"]);

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    // Scoped read: a retry both reveals the original row and spends money, so
    // another team's task must be unreachable here, not merely unstartable.
    const ws = await currentWorkspace();
    const task = getTask(id, ws);
    if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
    if (!RETRYABLE.has(task.status)) {
      return NextResponse.json(
        { error: "Only failed, interrupted or canceled tasks can be retried." },
        { status: 409 }
      );
    }
    // A kind this build no longer knows (row from an older version) can't replay.
    if (!isKnownKind(task.kind)) {
      return NextResponse.json({ error: `This task kind ("${task.kind}") no longer exists.` }, { status: 400 });
    }
    // The replay is stamped for the SAME tenant the original ran in (which the
    // ownership check above has already proven is the caller's own). Dropping it
    // here re-ran the work as the default tenant, so a non-default team's retry
    // silently executed against another team's data.
    const started = startTask(task.kind, (task.params as Record<string, unknown>) ?? {}, ws);
    return NextResponse.json({ task: started });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to retry the task.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
