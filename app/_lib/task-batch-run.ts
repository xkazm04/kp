// The two board-cohort task kinds — `batch_screen` and `batch_outreach` — and the
// role-fit score of a freshly filed entry (`score_entry`).
//
// Moved out of tasks.ts (2026-11-09) for the reason late-bound-boot.ts gives: tasks.ts is
// a hub every route that starts or polls a task imports, and these bodies reach the
// automation engine (runAutomationTask), the pipeline store and the workspace axis — the
// largest share of the ~240-module graph that hub used to carry. They are registered at
// boot (late-bound-boot.ts) and reached by tasks.ts through task-external-runners.ts,
// unchanged in behaviour: the same ctx, the same per-candidate isolation, the same codes.
import { getPipelineEntry, listActiveEntriesForAutomation } from "./db/pipeline";
import { getPipelineAxis } from "./pipeline-axis-server";
import { screeningStageIds } from "./pipeline-stages";
import { AutomationError, runAutomationTask } from "./automation-run";
import type { FanoutCode, FanoutItem } from "./task-fanout";
import type { ExternalTaskCtx } from "./task-external-runners";

export async function batchScreen(ctx: ExternalTaskCtx): Promise<unknown> {
  // Scope to the CALLER's team. listActiveEntriesForAutomation is tagged
  // `-- tenancy:global` for the clock-driven automation ENGINE, which legitimately
  // sweeps every tenant — but batch_screen is a per-recruiter click, and until
  // 2026-08-22 it ignored the ctx.workspaceId the runner threads in. Team A's click
  // spent A's LLM budget screening team B's board and wrote advance/hold decisions
  // into B's pipeline, while the summary A read back counted candidates A cannot see.
  //
  // WHICH entries: an explicit cohort when the caller names one (the board row's
  // "AI evaluate" passes the position's entry-column candidates), else every
  // candidate standing on a PRE-GATE column of this workspace's axis. The gate used to
  // be the literal "Screened" — a renamed axis screened nobody, and the entry column
  // (where triage volume is highest) was never swept from here.
  const wanted = Array.isArray(ctx.params.entryIds)
    ? new Set((ctx.params.entryIds as unknown[]).filter((x): x is string => typeof x === "string"))
    : null;
  const preGate = new Set(screeningStageIds(getPipelineAxis(ctx.workspaceId).stages));
  const entries = listActiveEntriesForAutomation().filter(
    (e) => e.workspaceId === ctx.workspaceId && (wanted ? wanted.has(e.id) : preGate.has(e.stage))
  );
  const summary = { advanced: 0, held: 0, advisory: 0, errors: 0, total: entries.length };
  // Per-candidate ledger (task-fanout.ts): ids and codes only.
  const results: FanoutItem[] = [];
  ctx.progress(0, entries.length, entries.length ? "Starting…" : "Nothing to screen");
  let done = 0;
  for (const e of entries) {
    if (ctx.signal.aborted) break;
    try {
      const out = await runAutomationTask(e.id, "screen", "", ctx.signal, undefined, e.workspaceId);
      if (out.applied === "advanced") summary.advanced += 1;
      else if (out.applied === "held_for_review") summary.held += 1;
      else summary.advisory += 1;
      results.push({ id: e.id, ok: true, applied: out.applied });
    } catch (err) {
      summary.errors += 1;
      results.push({ id: e.id, ok: false, code: itemCode(err) });
    }
    ctx.progress(++done, entries.length, e.candidateLabel);
  }
  return { ...summary, results };
}

// A per-item failure as a CODE, never its message (task-fanout.ts). The assignment is
// the compile-time check that every AutomationRefusal has a drawer label.
function itemCode(err: unknown): FanoutCode {
  if (err instanceof AutomationError && err.refusal) {
    const code: FanoutCode = err.refusal;
    return code;
  }
  return "engine_failed";
}

// Draft tailored OUTREACH for a board-selected cohort — one background job that
// runs the SAME per-candidate `outreach` automation the drawer's "Draft outreach"
// action runs (runAutomationTask → the LLM/deterministic letter → a HELD
// outreach_letters draft; nothing is sent until a person approves and releases each
// letter, comms scope C2 / outreach-release.ts). Reaching a filtered
// cohort of 8 was 8 drawer trips; this is one action. Per-candidate ISOLATION: one
// entry's failure (not found, no profile, consent-suppressed, LLM error) never
// aborts the others, and each id's outcome is reported back so the board can keep
// the failures selected for retry while successes deselect — the same batch grammar
// the synchronous move/decide endpoint uses. Drafting N letters is N LLM calls, so
// it runs here (backgrounded) instead of blocking the recruiter. Outreach is the
// ONLY drafting action batched from the board: its output is a reviewable,
// releasable held letter, whereas a rejection draft is a drawer-only result.
// Guard a runaway cohort (mirrors the sync batch endpoint's BATCH_CAP): the board
// rarely selects this many, and each id is an LLM call, so the wall-clock watchdog
// would otherwise reap a huge run mid-flight.
const OUTREACH_COHORT_CAP = 200;

export async function batchOutreach(ctx: ExternalTaskCtx): Promise<unknown> {
  const ids = (
    Array.isArray(ctx.params.entryIds)
      ? (ctx.params.entryIds as unknown[]).filter((x): x is string => typeof x === "string")
      : []
  ).slice(0, OUTREACH_COHORT_CAP);
  const results: FanoutItem[] = [];
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
      // override it. Mirrors the single-entry `automation` handler.
      // `applied` per item: a `suppressed_*` return is not a sent letter.
      const out = await runAutomationTask(id, "outreach", "", ctx.signal, undefined, ctx.workspaceId);
      results.push({ id, ok: true, applied: out.applied });
    } catch (e) {
      results.push({ id, ok: false, code: itemCode(e) });
    }
    ctx.progress(++done, ids.length, entry?.candidateLabel ?? id);
  }
  const ok = results.filter((r) => r.ok).length;
  return { ok, total: results.length, results };
}

// The role-fit score of a freshly filed entry (entry-scoring.ts), enqueued by the apply
// and inbound-CV doors. Imported on demand: the ranker's module graph is paid by the
// run, not by the boot list that registers this.
export async function scoreEntryTask(ctx: ExternalTaskCtx): Promise<unknown> {
  const entry = getPipelineEntry(String(ctx.params.entryId), ctx.workspaceId);
  if (!entry) return { scored: false };
  const { scoreFiledEntry } = await import("./entry-scoring");
  return { scored: await scoreFiledEntry(entry) };
}
