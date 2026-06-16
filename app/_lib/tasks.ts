import {
  createTask,
  finishTask,
  getActiveTaskByDedupe,
  getTask,
  interruptStaleTasks,
  lifecycleByPosting,
  listQueuedTaskIds,
  listActiveEntriesForAutomation,
  markTaskRunning,
  setTaskProgress,
  type TaskRecord,
} from "./db";
import { runAutomationTask } from "./automation-run";
import { runReasoning } from "./reasoning-run";
import { runAnalyze, type AnalyzeParams } from "./analyze-run";
import { runCommitReflection, runDesignArtifacts, runEvaluateSubmission, runNeedAnalysis, type DevNeed } from "./devcase-run";
import { runLifecycle } from "./devcase-orchestrator";
import { runGroupEval } from "./group-eval-run";
import { runJdBuild } from "./jd-build-run";
import { runInterviewPrep } from "./interview-prep-run";
import { randomId } from "./random-id";
import { buildDedupeKey } from "./task-dedupe";

// ---------------------------------------------------------------------------
// In-process background-task runner. Works because `next dev` is one long-lived
// node process: the handler runs detached from the request that started it, so
// it survives the user navigating away or the originating fetch ending. The
// `tasks` DB row is the source of truth, so the client can reconnect after a
// page refresh and the dedupe_key prevents duplicate concurrent runs.
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 2; // respect the Claude CLI subscription rate ceiling

// How far back the Background-tasks view shows finished tasks by default; older
// runs are paged in on demand via the history endpoint. One knob shared by the
// recent-list (GET /api/tasks) and history (GET /api/tasks/history) endpoints so
// their windows can never drift apart and leak/duplicate tasks at the boundary.
export const RECENT_TASK_WINDOW_DAYS = 7;
export function recentTaskCutoffIso(): string {
  return new Date(Date.now() - RECENT_TASK_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export type TaskCtx = {
  taskId: string;
  params: Record<string, unknown>;
  progress: (done: number, total: number, msg?: string) => void;
  signal: AbortSignal;
};

// The dedupe key is built by ./task-dedupe (buildDedupeKey), keyed by the same
// kind string as HANDLERS — kept out of the Spec so the identity logic stays
// pure and unit-testable and can return null ("no stable identity") for
// incomplete params.
type Spec = {
  run: (ctx: TaskCtx) => Promise<unknown>;
  label: (p: Record<string, unknown>) => string;
};

async function batchScreen(ctx: TaskCtx): Promise<unknown> {
  const entries = listActiveEntriesForAutomation().filter((e) => e.stage === "Screened");
  const summary = { advanced: 0, held: 0, advisory: 0, errors: 0, total: entries.length };
  ctx.progress(0, entries.length, entries.length ? "Starting…" : "Nothing to screen");
  let done = 0;
  for (const e of entries) {
    if (ctx.signal.aborted) break;
    try {
      const out = await runAutomationTask(e.id, "screen", "", ctx.signal);
      if (out.applied === "advanced") summary.advanced += 1;
      else if (out.applied === "held_for_review") summary.held += 1;
      else summary.advisory += 1;
    } catch {
      summary.errors += 1;
    }
    ctx.progress(++done, entries.length, e.candidateLabel);
  }
  return summary;
}

const HANDLERS: Record<string, Spec> = {
  automation: {
    run: (ctx) => runAutomationTask(String(ctx.params.entryId), String(ctx.params.task), String(ctx.params.notes ?? ""), ctx.signal),
    label: (p) => `${p.task} · ${p.entryLabel ?? p.entryId}`,
  },
  reasoning: {
    run: (ctx) => runReasoning(ctx.params, ctx.signal),
    label: (p) => `Why this candidate · ${p.label ?? p.jobId}`,
  },
  batch_screen: {
    run: batchScreen,
    label: () => "AI-screen all matched candidates",
  },
  analyze: {
    run: (ctx) => runAnalyze(ctx.params as unknown as AnalyzeParams, ctx.progress, ctx.signal),
    label: (p) => {
      const variants = (p.variants as { label: string }[]) ?? [];
      return `Analyze · ${variants[0]?.label ?? "CV"}${variants.length > 1 ? ` +${variants.length - 1}` : ""}`;
    },
  },
  need_analysis: {
    run: (ctx) => runNeedAnalysis(ctx.params.need as DevNeed, ctx.signal),
    label: (p) => `Need analysis · ${(p.need as { title?: string })?.title || "untitled"}`,
  },
  design_artifacts: {
    run: (ctx) => runDesignArtifacts(ctx.params.need as DevNeed, (ctx.params.analysis as Record<string, unknown>) ?? {}, ctx.signal),
    label: (p) => `Design artifacts · ${(p.need as { title?: string })?.title || "untitled"}`,
  },
  commit_reflection: {
    run: (ctx) => runCommitReflection(String(ctx.params.repoRef), ctx.params.caseId ? String(ctx.params.caseId) : undefined, ctx.signal),
    label: (p) => `Commit reflection · ${p.candidateRef ?? p.repoRef ?? ""}`,
  },
  evaluate_submission: {
    run: (ctx) => runEvaluateSubmission(String(ctx.params.submissionId), ctx.signal),
    label: (p) => `Evaluate · ${p.candidateRef ?? p.submissionId ?? ""}`,
  },
  lifecycle: {
    run: (ctx) => runLifecycle(String(ctx.params.lifecycleId), ctx.progress, ctx.signal),
    label: (p) => `Lifecycle · ${p.title ?? p.lifecycleId ?? ""}`,
  },
  group_eval: {
    run: (ctx) => runGroupEval(ctx.params, ctx.signal),
    label: (p) => `Group evaluation · ${p.roleTitle ?? p.roleKey ?? ""}`,
  },
  jd_build: {
    run: (ctx) => runJdBuild(ctx.params, ctx.progress, ctx.signal),
    label: (p) => `Build JD · ${p.title ?? "role"}`,
  },
  interview_prep: {
    run: (ctx) => runInterviewPrep(ctx.params, ctx.signal),
    label: (p) => `Interview prep · ${p.candidateLabel ?? p.entryId ?? ""}`,
  },
};

let booted = false;
let running = 0;
const queue: string[] = [];
const controllers = new Map<string, AbortController>();

// One-time, idempotent stale-task reconciliation for the current process. The
// in-process queue is volatile, so rows a previous process left behind are split
// two ways: 'running' rows were orphaned mid-flight and are unrecoverable
// (interruptStaleTasks marks them 'interrupted'), while 'queued' rows never
// started — they ran no side effects, so we re-enqueue them here instead of
// silently abandoning just-submitted work (a constant hazard in `next dev`, where
// saving a file hot-restarts the process). Safe to call from any entry point
// (startTask, the GET /api/tasks read path): the `booted` guard runs the sweep at
// most once, and on that first call the in-memory queue is still empty, so a task
// running in THIS process can never be clobbered or double-queued.
//
// Calling this from the read path matters because GET /api/tasks never starts a
// task, so without it a user who only reloads the dashboard after a crash sees a
// phantom spinner and TasksProvider polls every 2s forever. (instrumentation.ts
// also reconciles at boot; this keeps the task module self-healing on its own.)
export function ensureRecovered(): void {
  if (booted) return;
  booted = true;
  try {
    interruptStaleTasks(); // 'running' orphans → 'interrupted' (mid-flight, unrecoverable)
    // 'queued' orphans never ran a handler, so put them back on the queue in
    // submission order. The booted guard guarantees `queue` is empty here, but the
    // includes() check keeps this safe if recovery is ever wired to another caller.
    for (const id of listQueuedTaskIds()) {
      if (!queue.includes(id)) queue.push(id);
    }
    pump();
  } catch {
    /* table may not exist yet on a very first call; ensureDb creates it next */
  }
}

export function isKnownKind(kind: string): boolean {
  return kind in HANDLERS;
}

export function startTask(kind: string, params: Record<string, unknown>): TaskRecord {
  ensureRecovered();
  const spec = HANDLERS[kind];
  if (!spec) throw new Error(`unknown task kind: ${kind}`);
  // A stable key may reuse an in-flight run; a null key means the identifying
  // params were missing/empty, so we must NOT dedupe — merging on a collapsed
  // constant like `analyze:undefined` would hand this caller an unrelated
  // candidate's task and result (idea-5e38b9ad). Reuse only with a real identity.
  const stableKey = buildDedupeKey(kind, params);
  if (stableKey) {
    const existing = getActiveTaskByDedupe(stableKey);
    if (existing) return existing;
  }
  const id = randomId("t");
  const dedupeKey = stableKey ?? `${kind}:nodedupe:${id}`; // guaranteed-unique; never merges
  const rec = createTask(id, kind, dedupeKey, spec.label(params), params);
  queue.push(id);
  pump();
  return rec;
}

// Submission-intake event trigger, shared by the authenticated /submit route and
// the public /inbound webhook: if an automated lifecycle is collecting for this
// posting, resume it (evaluate the new submission -> rank -> promote). startTask
// dedups, so concurrent arrivals coalesce into one run. The single encoding so the
// resume condition can't drift between the two intake paths.
export function resumeCollectingLifecycle(postingId: string): void {
  const lc = lifecycleByPosting(postingId);
  if (lc && lc.stage === "collecting") {
    startTask("lifecycle", { lifecycleId: lc.id, title: lc.title });
  }
}

export function cancelTask(id: string): boolean {
  const controller = controllers.get(id);
  if (controller) {
    controller.abort();
    return true;
  }
  const i = queue.indexOf(id);
  if (i >= 0) {
    queue.splice(i, 1);
    finishTask(id, "canceled", {});
    return true;
  }
  return false;
}

function pump(): void {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const id = queue.shift()!;
    void runOne(id);
  }
}

async function runOne(id: string): Promise<void> {
  const task = getTask(id);
  if (!task) return;
  const spec = HANDLERS[task.kind];
  if (!spec) {
    finishTask(id, "failed", { error: `unknown kind ${task.kind}` });
    return;
  }
  // Construct the controller before the try (its constructor cannot throw) so it
  // stays in scope for catch/finally. Everything that mutates the slot accounting
  // — `running += 1`, controller registration, markTaskRunning — goes INSIDE the
  // try so the finally always runs and restores the slot. If markTaskRunning (or
  // any of this bookkeeping) throws, e.g. SQLITE_BUSY under contention, the catch
  // marks the row failed and the finally decrements `running`, keeping the runner
  // self-correcting instead of permanently leaking a MAX_CONCURRENT slot.
  const controller = new AbortController();
  try {
    running += 1;
    controllers.set(id, controller);
    markTaskRunning(id);
    const result = await spec.run({
      taskId: id,
      params: (task.params as Record<string, unknown>) ?? {},
      progress: (d, t, m) => setTaskProgress(id, d, t, m),
      signal: controller.signal,
    });
    finishTask(id, controller.signal.aborted ? "canceled" : "succeeded", { result });
  } catch (error) {
    // The recovery write reuses the same (possibly contended) DB connection that may
    // have just failed markTaskRunning. Guard it: an unguarded throw here escapes
    // `void runOne(id)` as an unhandled rejection AND leaves the row a phantom
    // 'running'/'queued'. On failure we log and let interruptStaleTasks reclaim the
    // row on the next start; the finally still restores the in-memory slot.
    try {
      finishTask(id, controller.signal.aborted ? "canceled" : "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } catch (finishErr) {
      console.error(
        `[tasks] could not mark task ${id} failed after a run error:`,
        finishErr instanceof Error ? finishErr.message : finishErr
      );
    }
  } finally {
    controllers.delete(id);
    running -= 1;
    pump();
  }
}
