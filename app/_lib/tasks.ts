import { lifecycleByPosting } from "./db/devcase";
import { getPipelineEntry, listActiveEntriesForAutomation } from "./db/pipeline";
import { createTask, finishTask, getActiveTaskByDedupe, getTask, interruptStaleTasks, listQueuedTaskIds, listRunningTaskTimes, pruneFinishedTasks, markTaskRunning, setTaskProgress, type TaskRecord } from "./db/tasks";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { withLlmRequestId } from "./llm-request-context";
import {
  TASK_MAX_RUNTIME_MS,
  TASK_RETENTION_DAYS,
  MAINTENANCE_INTERVAL_MS,
  tasksToReap,
  taskRetentionCutoffIso,
} from "./task-maintenance.ts";
import { runAutomationTask } from "./automation-run";
import { runReasoning } from "./reasoning-run";
import { runAnalyze, type AnalyzeParams } from "./analyze-run";
import { runDesignArtifacts, runEvaluateSubmission, runNeedAnalysis, type DevNeed } from "./devcase-run";
import { runLifecycle } from "./devcase-orchestrator";
import { RECENT_TASK_WINDOW_DAYS } from "./tasks-window";
export { RECENT_TASK_WINDOW_DAYS } from "./tasks-window";
import { runGroupEval } from "./group-eval-run";
import { runJdBuild } from "./jd-build-run";
import { runInterviewPrep } from "./interview-prep-run";
import { runAgentFit } from "./agent-hire/transform-run";
import { runRepoScan } from "./repo-scan-run";
import { runCampaign, type CampaignParams } from "./campaign-run";
import { runProfileDraft, type ProfileDraftParams } from "./profile-draft-run";
import { randomId } from "./random-id";
import { buildDedupeKey } from "./task-dedupe";
import { encodeTaskLabel } from "./task-label";

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
export function recentTaskCutoffIso(): string {
  return new Date(Date.now() - RECENT_TASK_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export type TaskCtx = {
  taskId: string;
  /** The team that enqueued the task (P1) — handlers thread it into their entry-keyed
   *  store calls so a tracked background job scopes to the same tenant as its recruiter. */
  workspaceId: string;
  params: Record<string, unknown>;
  progress: (done: number, total: number, msg?: string) => void;
  signal: AbortSignal;
};

// The dedupe key is built by ./task-dedupe (buildDedupeKey), keyed by the same
// kind string as HANDLERS — kept out of the Spec so the identity logic stays
// pure and unit-testable and can return null ("no stable identity") for
// incomplete params.
//
// `label` returns an ENCODED catalog reference (./task-label), never a sentence:
// this module runs with no request locale and the row it writes is read later by
// whoever has the screen open, in their language. Copy lives in `tasks.kind.*`.
type Spec = {
  run: (ctx: TaskCtx) => Promise<unknown>;
  label: (p: Record<string, unknown>) => string;
};

// Free-text detail lifted off params for a label placeholder. Empty/absent
// resolves to null so the caller can pick the "untitled" variant of the message
// rather than rendering a dangling separator.
function detail(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  return null;
}

async function batchScreen(ctx: TaskCtx): Promise<unknown> {
  // Scope to the CALLER's team. listActiveEntriesForAutomation is tagged
  // `-- tenancy:global` for the clock-driven automation ENGINE, which legitimately
  // sweeps every tenant — but batch_screen is a per-recruiter click, and until
  // 2026-08-22 it ignored the ctx.workspaceId the runner threads in. Team A's click
  // spent A's LLM budget screening team B's board and wrote advance/hold decisions
  // into B's pipeline, while the summary A read back counted candidates A cannot see.
  const entries = listActiveEntriesForAutomation().filter(
    (e) => e.stage === "Screened" && e.workspaceId === ctx.workspaceId
  );
  const summary = { advanced: 0, held: 0, advisory: 0, errors: 0, total: entries.length };
  ctx.progress(0, entries.length, entries.length ? "Starting…" : "Nothing to screen");
  let done = 0;
  for (const e of entries) {
    if (ctx.signal.aborted) break;
    try {
      const out = await runAutomationTask(e.id, "screen", "", ctx.signal, undefined, e.workspaceId);
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

// Draft tailored OUTREACH for a board-selected cohort — one background job that
// runs the SAME per-candidate `outreach` automation the drawer's "Draft outreach"
// action runs (runAutomationTask → the LLM/deterministic letter → dispatchOutreach,
// which QUEUES the draft to the Outbox by default and only relays it when a channel
// is configured; nothing is auto-sent in the demo default). Reaching a filtered
// cohort of 8 was 8 drawer trips; this is one action. Per-candidate ISOLATION: one
// entry's failure (not found, no profile, consent-suppressed, LLM error) never
// aborts the others, and each id's outcome is reported back so the board can keep
// the failures selected for retry while successes deselect — the same batch grammar
// the synchronous move/decide endpoint uses. Drafting N letters is N LLM calls, so
// it runs here (backgrounded) instead of blocking the recruiter. Outreach is the
// ONLY drafting action batched from the board: its output lands in the Outbox as a
// reviewable, releasable row, whereas a rejection draft is a drawer-only result.
// Guard a runaway cohort (mirrors the sync batch endpoint's BATCH_CAP): the board
// rarely selects this many, and each id is an LLM call, so the wall-clock watchdog
// would otherwise reap a huge run mid-flight.
const OUTREACH_COHORT_CAP = 200;

async function batchOutreach(ctx: TaskCtx): Promise<unknown> {
  const ids = (
    Array.isArray(ctx.params.entryIds)
      ? (ctx.params.entryIds as unknown[]).filter((x): x is string => typeof x === "string")
      : []
  ).slice(0, OUTREACH_COHORT_CAP);
  const results: { id: string; ok: boolean; reason?: string }[] = [];
  ctx.progress(0, ids.length, ids.length ? "Starting…" : "Nothing to draft");
  let done = 0;
  for (const id of ids) {
    if (ctx.signal.aborted) break;
    // Resolve the label for a friendly progress line; the entry is scoped to the
    // task's tenant, so an id from another workspace resolves null here AND makes
    // runAutomationTask throw "entry not found" — counted as a per-candidate failure.
    const entry = getPipelineEntry(id, ctx.workspaceId);
    try {
      // lang is undefined by design: outreach is a LETTER task, so runAutomationTask
      // resolves the CANDIDATE'S comms locale itself — the caller's UI locale must not
      // override it. Mirrors the single-entry `automation` handler above.
      await runAutomationTask(id, "outreach", "", ctx.signal, undefined, ctx.workspaceId);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, reason: e instanceof Error ? e.message : "Unexpected error." });
    }
    ctx.progress(++done, ids.length, entry?.candidateLabel ?? id);
  }
  const ok = results.filter((r) => r.ok).length;
  return { ok, total: results.length, results };
}

const HANDLERS: Record<string, Spec> = {
  automation: {
    run: (ctx) => runAutomationTask(String(ctx.params.entryId), String(ctx.params.task), String(ctx.params.notes ?? ""), ctx.signal, undefined, ctx.workspaceId),
    label: (p) => encodeTaskLabel("automation", { task: String(p.task ?? ""), entry: detail(p.entryLabel, p.entryId) ?? "" }),
  },
  reasoning: {
    run: (ctx) => runReasoning(ctx.params, ctx.signal, ctx.workspaceId),
    label: (p) => encodeTaskLabel("reasoning", { label: detail(p.label, p.jobId) ?? "" }),
  },
  batch_screen: {
    run: batchScreen,
    label: () => encodeTaskLabel("batchScreen"),
  },
  batch_outreach: {
    run: batchOutreach,
    label: (p) => {
      const n = Array.isArray(p.entryIds) ? (p.entryIds as unknown[]).length : 0;
      // The RAW number, never a formatted one: the message is an ICU plural and
      // `intl-messageformat` renders the literal word `NaN` for a pre-formatted
      // value (docs/architecture/localization.md).
      return encodeTaskLabel("batchOutreach", { n });
    },
  },
  analyze: {
    // The AI-candidate unit is debited INSIDE runAnalyze, only on a delivered non-cached
    // result — so a failed / canceled / duplicate run never charges. No upfront-debit +
    // refund dance is needed here (this supersedes that earlier approach).
    run: (ctx) => runAnalyze(ctx.params as unknown as AnalyzeParams, ctx.progress, ctx.signal),
    label: (p) => {
      const variants = (p.variants as { label: string }[]) ?? [];
      // "CV" is a do-not-translate term (docs/i18n/glossary.md), so the unnamed
      // fallback rides along as a value rather than needing its own message.
      const first = variants[0]?.label ?? "CV";
      return encodeTaskLabel("analyze", { label: `${first}${variants.length > 1 ? ` +${variants.length - 1}` : ""}` });
    },
  },
  need_analysis: {
    run: (ctx) => runNeedAnalysis(ctx.params.need as DevNeed, ctx.signal),
    label: (p) => {
      const title = detail((p.need as { title?: string })?.title);
      return title ? encodeTaskLabel("needAnalysis", { title }) : encodeTaskLabel("needAnalysisUntitled");
    },
  },
  design_artifacts: {
    run: (ctx) => runDesignArtifacts(ctx.params.need as DevNeed, (ctx.params.analysis as Record<string, unknown>) ?? {}, ctx.signal),
    label: (p) => {
      const title = detail((p.need as { title?: string })?.title);
      return title ? encodeTaskLabel("designArtifacts", { title }) : encodeTaskLabel("designArtifactsUntitled");
    },
  },
  evaluate_submission: {
    run: (ctx) => runEvaluateSubmission(String(ctx.params.submissionId), ctx.signal),
    label: (p) => encodeTaskLabel("evaluateSubmission", { ref: detail(p.candidateRef, p.submissionId) ?? "" }),
  },
  lifecycle: {
    run: (ctx) => runLifecycle(String(ctx.params.lifecycleId), ctx.progress, ctx.signal),
    label: (p) => encodeTaskLabel("lifecycle", { title: detail(p.title, p.lifecycleId) ?? "" }),
  },
  group_eval: {
    run: (ctx) => runGroupEval(ctx.params, ctx.signal, ctx.workspaceId),
    label: (p) => encodeTaskLabel("groupEval", { role: detail(p.roleTitle, p.roleKey) ?? "" }),
  },
  jd_build: {
    // The tenant rides the task row (every jd_build producer — /api/jds/generate,
    // /api/intake/[id]/promote, /api/jds/[slug]/retry-analysis — stamps it), so the
    // build files its matchable `jd-<slug>` opening into the team that asked for it.
    // Without this the JD row was created for the right team while its OPENING went
    // to the default one: the building team watched their JD flip to "ready" and then
    // never found it in Jobs, so "Source into Pipeline" dead-ended.
    run: (ctx) => runJdBuild(ctx.params, ctx.progress, ctx.signal, ctx.workspaceId),
    label: (p) => {
      const title = detail(p.title);
      return title ? encodeTaskLabel("jdBuild", { title }) : encodeTaskLabel("jdBuildUntitled");
    },
  },
  interview_prep: {
    run: (ctx) => runInterviewPrep(ctx.params, ctx.signal, ctx.workspaceId),
    label: (p) => encodeTaskLabel("interviewPrep", { candidate: detail(p.candidateLabel, p.entryId) ?? "" }),
  },
  // Agent-candidate bridge: job → AgentFitSpec transform (agent-hire/transform-run.ts).
  agent_fit: {
    run: (ctx) => runAgentFit(String(ctx.params.jobId), ctx.signal, ctx.workspaceId),
    label: (p) => encodeTaskLabel("agentFit", { job: detail(p.jobTitle, p.jobId) ?? "" }),
  },
  // App master (P2): read a codebase into a RepoDossier. Backgrounded because the
  // in-repo agent path is minutes, not seconds — and because the repo_scans row is
  // the durable result, so the operator can leave the intake and come back. The
  // handler persists onto that row itself (success AND failure), so a reaped task
  // still leaves an honest `failed` row rather than one stuck at `running`.
  repo_scan: {
    run: (ctx) => runRepoScan(ctx.params, ctx.signal, ctx.workspaceId, String(ctx.params.lang ?? "en")),
    label: (p) => encodeTaskLabel("repoScan", { repo: detail(p.repoUrl, p.rootPath, p.scanId) ?? "" }),
  },
  // Campaign pack (background path of POST /api/jobs/[id]/campaign): the pack
  // persists in campaign_packs, so leaving mid-run loses nothing — the Campaign
  // tab reloads the finished pack on the next visit.
  campaign: {
    run: (ctx) => runCampaign(ctx.params as unknown as CampaignParams, ctx.signal, ctx.workspaceId),
    label: (p) => encodeTaskLabel("campaign", { job: detail(p.jobTitle, p.jobId) ?? "" }),
  },
  // AI profile draft (background path of POST /api/profile/draft): the draft is
  // the task RESULT (not persisted) — the editor applies it live when watched,
  // and it stays readable from the Background-tasks view otherwise.
  profile_draft: {
    run: (ctx) => runProfileDraft(ctx.params as unknown as ProfileDraftParams, ctx.signal),
    label: () => encodeTaskLabel("profileDraft"),
  },
};

let booted = false;
let running = 0;
const queue: string[] = [];
const controllers = new Map<string, AbortController>();
let lastMaintenanceMs = 0;

// Opportunistic, throttled housekeeping driven off task submissions (NOT the
// automation clock, which is separately monitored and can die — Finding 1):
//   #2 reap orphaned 'running' rows past the wall-clock budget that have NO live
//      in-process controller (a row this process isn't watching — e.g. left by a
//      prior incarnation the boot sweep raced). A row we ARE watching is left to
//      its own runOne watchdog, which is what actually frees the in-memory slot.
//   #3 delete terminal rows older than the retention window so params_json /
//      result_json blobs can't accumulate forever.
// Best-effort and self-contained: any failure is logged and the next submission
// retries. Exported so tests / callers can force a sweep.
export function runMaintenance(nowMs: number = Date.now()): void {
  if (nowMs - lastMaintenanceMs < MAINTENANCE_INTERVAL_MS) return;
  lastMaintenanceMs = nowMs;
  try {
    for (const id of tasksToReap(listRunningTaskTimes(), nowMs)) {
      if (controllers.has(id)) continue; // an in-process watchdog owns this one
      finishTask(id, "interrupted", { error: "reaped: running past the wall-clock budget with no live handler" });
    }
  } catch (e) {
    console.error("[tasks] stale-task reaper failed:", e);
  }
  try {
    const pruned = pruneFinishedTasks(taskRetentionCutoffIso(nowMs));
    if (pruned) console.log(`[tasks] pruned ${pruned} finished task(s) older than ${TASK_RETENTION_DAYS}d`);
  } catch (e) {
    console.error("[tasks] retention prune failed:", e);
  }
}

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

export function startTask(
  kind: string,
  params: Record<string, unknown>,
  // Tenant (P2): the workspace this run belongs to. Stamped on the task row so
  // per-tenant reads (the reservation gate that counts in-flight runs, the /api/tasks
  // poll) scope to the right team instead of lumping every tenant under the default.
  // Defaults to the single workspace, so the single-tenant path is byte-identical.
  workspaceId: string = DEFAULT_WORKSPACE_ID
): TaskRecord {
  ensureRecovered();
  runMaintenance(); // throttled reap + retention prune, piggy-backed on submissions
  const spec = HANDLERS[kind];
  if (!spec) throw new Error(`unknown task kind: ${kind}`);
  // A stable key may reuse an in-flight run; a null key means the identifying
  // params were missing/empty, so we must NOT dedupe — merging on a collapsed
  // constant like `analyze:undefined` would hand this caller an unrelated
  // candidate's task and result (idea-5e38b9ad). Reuse only with a real identity.
  // Dedup is scoped to THIS workspace so one tenant's run never coalesces onto
  // another's identical key.
  const stableKey = buildDedupeKey(kind, params);
  if (stableKey) {
    const existing = getActiveTaskByDedupe(stableKey, workspaceId);
    if (existing) return existing;
  }
  const id = randomId("t");
  const dedupeKey = stableKey ?? `${kind}:nodedupe:${id}`; // guaranteed-unique; never merges
  const rec = createTask(id, kind, dedupeKey, spec.label(params), params, workspaceId);
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
  // Wall-clock watchdog (Finding 2). A handler that HANGS (an LLM/HTTP call with
  // no timeout, a stuck lock, SQLite contention) would otherwise never settle, so
  // its row stays 'running' and holds one of only MAX_CONCURRENT slots forever;
  // two hangs deadlock the whole queue. Race the handler against a hard budget:
  // when it fires we abort (cooperative — a well-behaved handler bails) and treat
  // the row as 'interrupted', so the finally ALWAYS frees the slot even if the
  // handler never settles. This makes "a stuck handler holds a slot forever"
  // impossible at the runner level rather than per handler.
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const TIMED_OUT = Symbol("timed-out");
  try {
    running += 1;
    controllers.set(id, controller);
    markTaskRunning(id);
    // Open the ambient LLM-request scope around the handler: every spawnPython
    // call it makes, at any async depth, tags its metered ledger rows with this
    // task id (see llm-request-context.ts). That's the join key the Insights →
    // Activity row-click detail uses to fetch the run whose output the row
    // produced — without it, `request_id` stays the null it has always been.
    const runPromise = withLlmRequestId(id, () =>
      spec.run({
        taskId: id,
        workspaceId: task.workspaceId,
        params: (task.params as Record<string, unknown>) ?? {},
        progress: (d, t, m) => setTaskProgress(id, d, t, m),
        signal: controller.signal,
      })
    );
    // A hung handler that loses this race is orphaned (a JS promise can't be
    // force-killed); swallow any late rejection so it can't surface as an
    // unhandledRejection after we've already moved the slot on.
    runPromise.catch(() => {});
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      watchdog = setTimeout(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, TASK_MAX_RUNTIME_MS);
      (watchdog as { unref?: () => void }).unref?.(); // never keep the process alive for the watchdog alone
    });
    const outcome = await Promise.race([runPromise, timeout]);
    if (outcome === TIMED_OUT) {
      finishTask(id, "interrupted", { error: `exceeded the ${TASK_MAX_RUNTIME_MS}ms wall-clock budget` });
    } else {
      finishTask(id, controller.signal.aborted ? "canceled" : "succeeded", { result: outcome });
    }
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
    if (watchdog) clearTimeout(watchdog);
    controllers.delete(id);
    running -= 1;
    pump();
  }
}
