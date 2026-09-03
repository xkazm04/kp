import { existsSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/app/_lib/db/tasks";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { isKnownKind, startTask } from "@/app/_lib/tasks";
import { taskBudget, taskBudgetClass } from "@/app/_lib/task-budget";

// Every accepted retry re-spends — a real LLM call and/or a Python spawn — so this
// door carries the SAME per-class budget as POST /api/tasks (app/_lib/task-budget.ts)
// under its own keys, plus a tighter overall bucket of its own.
const TASKS_RETRY_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };


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
    if (!task) return jsonRefusal("TASK_NOT_FOUND", 404);
    if (!RETRYABLE.has(task.status)) {
      // The status rides along so the dock can say WHICH state refused, in the
      // reader's language, instead of painting this handler's English.
      return jsonRefusal("TASK_NOT_RETRYABLE", 409, { status: task.status });
    }
    // A kind this build no longer knows (row from an older version) can't replay.
    if (!isKnownKind(task.kind)) {
      return jsonRefusal("TASK_KIND_UNKNOWN", 400, { kind: task.kind });
    }
    const params = (task.params as Record<string, unknown>) ?? {};
    // Refuse a replay whose inputs no longer exist (see replayInputsMissing) —
    // BEFORE startTask, so it costs no queue slot and no subprocess.
    if (replayInputsMissing(task.kind, params)) {
      return jsonRefusal("TASK_REPLAY_INPUTS_GONE", 409);
    }
    // THROTTLE (rate-limit-contract.test.ts): every accepted retry re-spends — a real
    // LLM call and/or a Python spawn. Placed AFTER the ownership and status refusals
    // so a rejected click consumes no budget, and before startTask so an accepted one
    // is bounded. Same door as POST /api/tasks (see its header), which this bypasses.
    const ip = clientIpFrom(request.headers);
    if (!rateLimit(`tasks-retry:${ip}`, TASKS_RETRY_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // The per-class budget too: a retry of a repo_scan costs exactly what the
    // original did, and this door bypasses POST /api/tasks entirely. Same keys as
    // that route, so the two spend ONE workspace allowance between them rather than
    // two — replaying is not a way to double the budget.
    const cls = taskBudgetClass(task.kind);
    const budget = taskBudget(task.kind);
    if (!rateLimit(`tasks-start:${cls}:${ip}`, budget.ip)) {
      return jsonRefusal("TASK_BUDGET_EXHAUSTED", 429, { budgetClass: cls });
    }
    if (budget.workspace && !rateLimit(`tasks-start-ws:${cls}:${ws}`, budget.workspace)) {
      return jsonRefusal("TASK_BUDGET_EXHAUSTED", 429, { budgetClass: cls });
    }
    // The replay is stamped for the SAME tenant the original ran in (which the
    // ownership check above has already proven is the caller's own). Dropping it
    // here re-ran the work as the default tenant, so a non-default team's retry
    // silently executed against another team's data.
    const started = startTask(task.kind, params, ws);
    return NextResponse.json({ task: started });
  } catch (error) {
    // The row read and the enqueue both go through better-sqlite3; the thrown
    // message carries the db path and SQLite detail, never client copy.
    return safeJsonError(error, "api:tasks/retry", "TASK_RETRY_FAILED");
  }
}
