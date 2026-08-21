import { existsSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/app/_lib/db/tasks";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { isKnownKind, startTask } from "@/app/_lib/tasks";


// DATA1 — one-click replay of a dead task. `params_json` is the exact request
// that was originally submitted, durably persisted on every row, so a retry is
// just `startTask(kind, params)` run server-side — the (potentially multi-MB)
// params never round-trip through the client. Almost every handler's params are
// self-contained (inline text/objects) or DB-keyed (entryId / submissionId /
// lifecycleId / repoRef), so they replay unchanged. `buildDedupeKey` makes a
// double-click merge into the in-flight run instead of duplicating it.
const RETRYABLE = new Set(["failed", "interrupted", "canceled"]);

// The ONE kind whose params are not self-contained. /api/analyze persists the
// uploaded CVs (and any JD/company file) into a temp workdir BEFORE enqueuing, and
// passes their paths — `baseDir` + `variants[].cvPath` — in the params; runAnalyze
// then `rm -rf`s that workdir in a `finally`, i.e. on EVERY exit, failure and cancel
// included. So a dead analyze row's params reference files that are already gone,
// and replaying it queued a run that could only fail again: a second red row, a
// wasted Python spawn, and an engine ENOENT shown to the recruiter instead of "the
// upload is gone, add it again". (An earlier revision of this comment asserted the
// opposite — that analyze spills to its workdir at RUN time — which is what let the
// dead button ship.)
//
// This is an existence CHECK, not a ban on the kind: when the process died before
// the cleanup ran (a crash leaves the row 'interrupted'), the workdir IS still on
// disk and the replay is genuinely valid, so it still goes through.
function replayInputsMissing(kind: string, params: Record<string, unknown>): boolean {
  if (kind !== "analyze") return false;
  const paths: string[] = [];
  if (typeof params.baseDir === "string" && params.baseDir) paths.push(params.baseDir);
  const variants = Array.isArray(params.variants) ? params.variants : [];
  for (const variant of variants) {
    const cvPath = (variant as { cvPath?: unknown } | null)?.cvPath;
    if (typeof cvPath === "string" && cvPath) paths.push(cvPath);
  }
  // Unrecognizable params (an old or hand-written row) carry no claim either way —
  // let the replay proceed rather than refusing on a guess.
  return paths.length > 0 && paths.some((p) => !existsSync(p));
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    const params = (task.params as Record<string, unknown>) ?? {};
    // Refuse a replay whose inputs no longer exist (see replayInputsMissing) —
    // BEFORE startTask, so it costs no queue slot and no subprocess.
    if (replayInputsMissing(task.kind, params)) {
      return NextResponse.json(
        { error: "The uploaded files for this run have been cleaned up. Upload them again to re-run it." },
        { status: 409 }
      );
    }
    // THROTTLE (rate-limit-contract.test.ts): every accepted retry re-spends — a real
    // LLM call and/or a Python spawn. Placed AFTER the ownership and status refusals
    // so a rejected click consumes no budget, and before startTask so an accepted one
    // is bounded. Same door as POST /api/tasks (see its header), which this bypasses.
    if (!rateLimit(`tasks-retry:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    // The replay is stamped for the SAME tenant the original ran in (which the
    // ownership check above has already proven is the caller's own). Dropping it
    // here re-ran the work as the default tenant, so a non-default team's retry
    // silently executed against another team's data.
    const started = startTask(task.kind, params, ws);
    return NextResponse.json({ task: started });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to retry the task.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
