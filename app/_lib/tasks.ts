import {
  createTask,
  finishTask,
  getActiveTaskByDedupe,
  getTask,
  interruptStaleTasks,
  listActiveEntriesForAutomation,
  markTaskRunning,
  setTaskProgress,
  type TaskRecord,
} from "./db";
import { runAutomationTask } from "./automation-run";
import { runReasoning } from "./reasoning-run";
import { runAnalyze, type AnalyzeParams } from "./analyze-run";
import { runCommitReflection, runDesignArtifacts, runNeedAnalysis, type DevNeed } from "./devcase-run";

// ---------------------------------------------------------------------------
// In-process background-task runner. Works because `next dev` is one long-lived
// node process: the handler runs detached from the request that started it, so
// it survives the user navigating away or the originating fetch ending. The
// `tasks` DB row is the source of truth, so the client can reconnect after a
// page refresh and the dedupe_key prevents duplicate concurrent runs.
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 2; // respect the Claude CLI subscription rate ceiling

export type TaskCtx = {
  taskId: string;
  params: Record<string, unknown>;
  progress: (done: number, total: number, msg?: string) => void;
  signal: AbortSignal;
};

type Spec = {
  run: (ctx: TaskCtx) => Promise<unknown>;
  label: (p: Record<string, unknown>) => string;
  dedupe: (p: Record<string, unknown>) => string;
};

async function batchScreen(ctx: TaskCtx): Promise<unknown> {
  const entries = listActiveEntriesForAutomation().filter((e) => e.stage === "AI-matched");
  const summary = { advanced: 0, held: 0, advisory: 0, errors: 0, total: entries.length };
  ctx.progress(0, entries.length, entries.length ? "Starting…" : "Nothing to screen");
  let done = 0;
  for (const e of entries) {
    if (ctx.signal.aborted) break;
    try {
      const out = await runAutomationTask(e.id, "screen");
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
    run: (ctx) => runAutomationTask(String(ctx.params.entryId), String(ctx.params.task), String(ctx.params.notes ?? "")),
    label: (p) => `${p.task} · ${p.entryLabel ?? p.entryId}`,
    dedupe: (p) => `automation:${p.entryId}:${p.task}:${p.notes ? "n" : ""}`,
  },
  reasoning: {
    run: (ctx) => runReasoning(ctx.params),
    label: (p) => `Why this candidate · ${p.label ?? p.jobId}`,
    dedupe: (p) => `reasoning:${p.profileId ?? p.analysisSlug ?? JSON.stringify(p.candidate ?? "")}:${p.jobId}`,
  },
  batch_screen: {
    run: batchScreen,
    label: () => "AI-screen all matched candidates",
    dedupe: () => "batch_screen",
  },
  analyze: {
    run: (ctx) => runAnalyze(ctx.params as unknown as AnalyzeParams, ctx.progress),
    label: (p) => {
      const variants = (p.variants as { label: string }[]) ?? [];
      return `Analyze · ${variants[0]?.label ?? "CV"}${variants.length > 1 ? ` +${variants.length - 1}` : ""}`;
    },
    dedupe: (p) => `analyze:${p.baseDir}`, // baseDir is unique per upload
  },
  need_analysis: {
    run: (ctx) => runNeedAnalysis(ctx.params.need as DevNeed),
    label: (p) => `Need analysis · ${(p.need as { title?: string })?.title || "untitled"}`,
    dedupe: (p) => `need_analysis:${JSON.stringify(p.need ?? {})}`,
  },
  design_artifacts: {
    run: (ctx) => runDesignArtifacts(ctx.params.need as DevNeed, (ctx.params.analysis as Record<string, unknown>) ?? {}),
    label: (p) => `Design artifacts · ${(p.need as { title?: string })?.title || "untitled"}`,
    dedupe: (p) => `design_artifacts:${JSON.stringify(p.need ?? {})}:${JSON.stringify(p.analysis ?? {})}`,
  },
  commit_reflection: {
    run: (ctx) => runCommitReflection(String(ctx.params.repoRef), ctx.params.caseId ? String(ctx.params.caseId) : undefined),
    label: (p) => `Commit reflection · ${p.candidateRef ?? p.repoRef ?? ""}`,
    dedupe: (p) => `commit_reflection:${p.repoRef}:${p.caseId ?? ""}`,
  },
};

let booted = false;
let running = 0;
const queue: string[] = [];
const controllers = new Map<string, AbortController>();

function boot(): void {
  if (booted) return;
  booted = true;
  try {
    interruptStaleTasks();
  } catch {
    /* table may not exist yet on a very first call; ensureDb creates it next */
  }
}

export function isKnownKind(kind: string): boolean {
  return kind in HANDLERS;
}

export function startTask(kind: string, params: Record<string, unknown>): TaskRecord {
  boot();
  const spec = HANDLERS[kind];
  if (!spec) throw new Error(`unknown task kind: ${kind}`);
  const dedupeKey = spec.dedupe(params);
  const existing = getActiveTaskByDedupe(dedupeKey); // <- dedup: reuse the in-flight run
  if (existing) return existing;
  const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const rec = createTask(id, kind, dedupeKey, spec.label(params), params);
  queue.push(id);
  pump();
  return rec;
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
  running += 1;
  const controller = new AbortController();
  controllers.set(id, controller);
  markTaskRunning(id);
  try {
    const result = await spec.run({
      taskId: id,
      params: (task.params as Record<string, unknown>) ?? {},
      progress: (d, t, m) => setTaskProgress(id, d, t, m),
      signal: controller.signal,
    });
    finishTask(id, controller.signal.aborted ? "canceled" : "succeeded", { result });
  } catch (error) {
    finishTask(id, controller.signal.aborted ? "canceled" : "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    controllers.delete(id);
    running -= 1;
    pump();
  }
}
