import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  actOnPipelineEntry,
  getJob,
  hasEventToday,
  listActiveEntriesForAutomation,
  recordAutomationEvent,
  setApproval,
  setEntryMatchScore,
  type AutomationEntry,
} from "./db";
import { resolveCandidatePoolEntry } from "./candidate-pool";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, PipelineError, spawnPython } from "./python-runner";
import { rankPoolForJob } from "./recruiter-run";
import { assertAutoRejectFair, type AutoRejectVerdict } from "./automation-fairness";
import { FAIRNESS_GATE_BLOCKED_REJECT, type DecisionOutcome } from "./decision-attribution";

// Audit event kind logged when the TS fairness backstop refuses a Python reject
// and downgrades it to a hold. A non-zero count here means an upstream regression
// tried to auto-reject an entry the fairness invariant protects — see
// automation-fairness.ts (assertAutoRejectFair). Sourced from the shared
// AUTOMATION_ALERT_KINDS set (decision-attribution.ts) so the writer and the
// attribution map can never key it differently.
export const FAIRNESS_BLOCKED_REJECT_ALERT = FAIRNESS_GATE_BLOCKED_REJECT;

// THE single encoding of the fairness-backstop downgrade, shared by the dry-run
// preview loop and the commit loop so the preview provably shows the SAME verdict
// the commit enforces (the spec-pinned "preview must match commit" guarantee —
// docs/AUTOMATION_SPEC.md §risks). On an allowed verdict it does nothing and
// returns false; on a refused verdict it downgrades the decision to a hold,
// rewrites the reason, appends the dedup alert, bumps `summary.held`, and returns
// true. `preview` selects only the "would be refused" vs "refused" wording so a
// dry run reads as a forecast while the commit reads as an applied refusal —
// every other byte is identical across the two callers.
// Optimistic-CAS stale handling, shared by the advance and reject apply branches:
// when actOnPipelineEntry refuses because the snapshot stage no longer holds (a
// recruiter or concurrent pass moved the entry during the Python hop), turn the
// decision into a no-op and record WHY, instead of acting on whatever stage the
// entry is in now. The single encoding so both stale branches skip identically.
function markStaleSkip(d: AutomationDecision): void {
  d.action = "none";
  d.outcome = "skipped";
  d.reason = `Skipped: stage changed mid-pass. Original policy decision: ${d.reason}`;
}

function applyFairnessVerdict(
  d: AutomationDecision,
  verdict: AutoRejectVerdict,
  summary: AutomationSummary,
  preview: boolean
): boolean {
  if (verdict.allowed) return false;
  d.action = "hold";
  d.outcome = "fairness_blocked";
  d.reason = `Auto-reject ${preview ? "would be refused" : "refused"} by fairness backstop: ${verdict.reason}. Original policy decision: ${d.reason}`;
  d.alerts = (d.alerts ?? []).includes(FAIRNESS_BLOCKED_REJECT_ALERT)
    ? d.alerts
    : [...(d.alerts ?? []), FAIRNESS_BLOCKED_REJECT_ALERT];
  summary.held += 1;
  return true;
}

// Task 7 — deterministic policy pass over all active entries. LLM-free. Extracted
// from the route so it has ONE home shared by /api/automation/run (the button +
// any external cron) and the in-process scheduler clock (instrumentation.ts).

export type AutomationDecision = {
  entryId: string;
  action: "advance" | "reject" | "hold" | "none";
  toStage: string | null;
  alerts: string[];
  reason: string;
  /** Apply-step outcome, set by executeAutomationPass and persisted with the
   *  run. Rows persisted before the field existed derive it from the reason
   *  prefix (deriveDecisionOutcome in decision-attribution.ts). */
  outcome?: DecisionOutcome;
};
// `evaluated` = how many active entries the pass actually scanned. It distinguishes a
// healthy idle pass (evaluated N, 0 actions) from a pass that saw NOTHING (evaluated 0 —
// empty/terminal board, or a status-filter regression), which otherwise both logged an
// all-zero "ok" run — the exact success-theater the orchestration status surface should prevent.
export type AutomationSummary = { advanced: number; rejected: number; held: number; alerts: number; errors: number; evaluated: number };
export type AutomationPassResult = { summary: AutomationSummary; decisions: AutomationDecision[] };

export class AutomationPassError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Single-flight guard (idea-3ee43d5c). claimDueRun() only serializes the CLOCK
// path — the "Run automation pass" button (/api/automation/run), an external
// cron hitting that route, and a forced tick (tickScheduler {force:true}) all
// call runAutomationPass directly. Two overlapping passes each snapshot ALL
// active entries, spend seconds in Python, then both apply: every per-entry race
// amplified across the whole board at once, plus duplicate candidate emails.
// In-process single-flight closes this: the second caller JOINS the in-flight
// pass and receives its result instead of starting a competing one. (Cross-
// process overlap is already covered for the clock by claimDueRun; the manual
// surfaces run in the same Next server process as the heartbeat.)
let inFlightPass: Promise<AutomationPassResult> | null = null;

/** True when a policy pass is mid-flight. tickScheduler checks this BEFORE calling
 *  runAutomationPass so it can tell "I started the pass" from "I joined an in-flight one"
 *  and only advance the clock / record a run for the caller that actually started it. */
export function isPassInFlight(): boolean {
  return inFlightPass !== null;
}

export function runAutomationPass(opts?: { dryRun?: boolean }): Promise<AutomationPassResult> {
  // AUTO3 — a dry run is read-only (no applies, no dispatches, no score writes),
  // so it neither joins nor blocks the single-flight: previewing must never
  // return an already-APPLIED pass's result as if it were a preview.
  if (opts?.dryRun) return executeAutomationPass(true);
  if (inFlightPass) return inFlightPass;
  inFlightPass = executeAutomationPass(false).finally(() => {
    inFlightPass = null;
  });
  return inFlightPass;
}

// AUTO1 — the pre-policy scoring sweep. Every inbound applicant (conversational
// apply, sim/inbound) lands in Accepted with matchScore null; the policy pass
// deterministically holds them "awaiting match score" and NOTHING ever computed
// that score — match_score was INSERT-only, so the funnel's front door
// deadlocked at the first automation gate forever. This scores unscored,
// non-degraded entries with a resolvable pool candidate + a known job, via the
// same deterministic recruiter_cli ranking the candidates/rediscovery surfaces
// use (LLM-free, sub-second). Best-effort per job: a scoring failure leaves the
// entry held exactly as before, never blocks the pass.
async function scoreUnscoredEntries(entries: AutomationEntry[], dryRun: boolean): Promise<void> {
  const unscored = entries.filter(
    (e) => e.matchScore == null && !e.intakeDegraded && e.candidateId && e.jobId && !e.candidateId.startsWith("ds-")
  );
  if (unscored.length === 0) return;

  // Group by job — one recruiter_cli spawn scores all of a job's newcomers.
  const byJob = new Map<string, AutomationEntry[]>();
  for (const e of unscored) {
    const list = byJob.get(e.jobId as string) ?? [];
    list.push(e);
    byJob.set(e.jobId as string, list);
  }

  for (const [jobId, group] of byJob) {
    try {
      const candidates = group
        // Each entry resolves within its OWN workspace — the global sweep spans
        // tenants, so a candidate must never resolve against another team's store.
        .map((e) => resolveCandidatePoolEntry(e.candidateId as string, e.candidateLabel, e.workspaceId))
        .filter((c): c is NonNullable<typeof c> => c !== null);
      if (candidates.length === 0) continue;

      // Pass the DB job directly when it exists, so ingested (non-corpus) jobs
      // score too — same contract as the candidates route. A CLI failure throws a
      // PipelineError, caught below so the bad job is skipped and the sweep
      // continues (the entry stays held exactly as before).
      const job = getJob(jobId);
      const payload = await rankPoolForJob<{ candidates?: { candidateId?: string; result?: { total?: number } }[] }>(
        jobId,
        candidates,
        job,
      );
      const scoreById = new Map<string, number>();
      for (const row of payload.candidates ?? []) {
        const total = row.result?.total;
        if (row.candidateId && typeof total === "number" && Number.isFinite(total)) {
          scoreById.set(row.candidateId, Math.round(total));
        }
      }
      for (const e of group) {
        const score = scoreById.get(e.candidateId as string);
        if (score == null) continue;
        if (dryRun) {
          // Preview-only: patch the snapshot so the policy step previews the
          // post-scoring verdict, but persist nothing — the committed run
          // recomputes the same deterministic score and writes it then.
          e.matchScore = score;
        } else if (setEntryMatchScore(e.id, score, e.workspaceId)) {
          // Patch the in-memory snapshot so THIS pass's policy step (and the
          // fairness backstop reading the same snapshot) sees the fresh score.
          e.matchScore = score;
          recordAutomationEvent(e.id, "scored", `${score} vs ${e.jobTitle ?? jobId}`, e.workspaceId);
        }
      }
    } catch (error) {
      if (error instanceof PipelineError) {
        console.error(`[automation-pass] auto-score failed for job ${jobId}: ${error.message}`);
      } else {
        console.error(`[automation-pass] auto-score sweep failed for job ${jobId}`, error);
      }
    }
  }
}

async function executeAutomationPass(dryRun: boolean): Promise<AutomationPassResult> {
  const entries = listActiveEntriesForAutomation();
  const summary: AutomationSummary = { advanced: 0, rejected: 0, held: 0, alerts: 0, errors: 0, evaluated: entries.length };
  if (entries.length === 0) return { summary, decisions: [] };

  // AUTO1 — score the unscored BEFORE the policy step, so an inbound applicant
  // is triaged on this very pass instead of held "awaiting match score" forever.
  await scoreUnscoredEntries(entries, dryRun);

  let workdir: string | null = null;
  try {
    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "entries.json");
    await writeFile(inputPath, JSON.stringify(entries), "utf-8");

    const { result } = spawnPython(["-m", "pipeline.jobfit.automation_cli", "policy-pass", "--entries-json", inputPath]);
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new AutomationPassError(err.message, err.status);
    }

    const { decisions } = parsePythonJson<{ decisions: AutomationDecision[] }>(stdout, stderr);
    // Keep the entry snapshots keyed by id so the apply boundary can re-check the
    // fairness invariant against the SAME archetype/score the policy pass saw.
    const byId = new Map(entries.map((e) => [e.id, e]));

    // AUTO3 — dry run: identical snapshot → Python → decisions flow, but the
    // apply/dispatch loop is replaced by annotation. The fairness backstop is
    // still consulted per reject (the preview must show the verdict the commit
    // would actually enforce); nothing is written and no candidate is emailed.
    if (dryRun) {
      for (const d of decisions) {
        if (!d.entryId) continue;
        if (d.action === "advance") {
          summary.advanced += 1;
        } else if (d.action === "reject") {
          const verdict = assertAutoRejectFair(byId.get(d.entryId));
          if (!applyFairnessVerdict(d, verdict, summary, true)) {
            summary.rejected += 1;
          }
        } else if (d.action === "hold") {
          summary.held += 1;
        }
        summary.alerts += (d.alerts ?? []).length;
      }
      return { summary, decisions };
    }

    // AUTO1 RETIRED (UAT M6 / GDPR Art. 22): a rejection is the one irreversible,
    // candidate-visible ADVERSE action, so the pass NEVER applies it unattended —
    // every fairness-cleared reject is queued for a human on the Decisions gate.
    // Advances, holds and alerts stay autonomous. This keeps the candidate
    // disclosure ("nothing adverse is decided automatically") true for EVERY
    // candidate, unconditionally; the former opt-in `auto` reject mode is gone.
    for (const d of decisions) {
      if (!d.entryId) continue;
      // One decision's apply failing (a comm throw from dispatchRejection, a
      // transient SQLITE_BUSY past busy_timeout) must NOT abort the whole pass —
      // that discards the summary of everything already applied AND skips every
      // later decision, leaving a half-applied board. Isolate each decision.
      try {
      // Optimistic CAS (idea-b6310b92): the policy decided against the SNAPSHOT
      // stage, but the Python hop takes seconds — a recruiter (or a concurrent
      // pass) may have moved the entry meanwhile. Passing expectedStage makes a
      // stale verdict a logged no-op instead of an action applied to whatever
      // stage the entry happens to be in NOW.
      // Global sweep spans teams, so each write scopes to THIS entry's own workspace.
      const entrySnap = byId.get(d.entryId);
      const snapshotStage = entrySnap?.stage;
      const entryWs = entrySnap?.workspaceId;
      if (d.action === "advance") {
        const applied = actOnPipelineEntry(d.entryId, "accept", d.reason, { expectedStage: snapshotStage, expectedApprovalKind: entrySnap?.approvalKind, actor: "system" }, entryWs); // logs `auto_advanced` + stamps stage_changed_at; the approval CAS refuses if a human queued a review mid-hop
        if (applied) {
          summary.advanced += 1;
          d.outcome = "applied";
        } else {
          markStaleSkip(d);
        }
      } else if (d.action === "reject") {
        // Defense in depth: re-assert the fairness invariant before applying a
        // reject (BAU<40 only — enforced in evaluate_entry). If Python regressed and
        // emitted a reject for a protected/unscored/at-or-above-floor entry, REFUSE
        // it — downgrade to a hold + alert rather than silently auto-rejecting.
        const verdict = assertAutoRejectFair(byId.get(d.entryId));
        // Refused → the shared helper downgrades to a hold + dedup alert (sets
        // outcome=fairness_blocked, bumps summary.held, appends the alert recorded
        // by the loop below), routed to the human Decisions gate rather than
        // actioned. Otherwise, in supervised "approve" mode (the default) the
        // fairness-cleared reject is QUEUED for a human click instead of applied;
        // only "auto" mode applies + emails it unattended.
        if (applyFairnessVerdict(d, verdict, summary, false)) {
          // refused — the helper already downgraded this decision to a hold.
        } else {
          // Mandatory human-in-the-loop: QUEUE the fairness-cleared reject for a
          // human click instead of applying it. The payload uses the screening-
          // review shape AiReviewCard already renders; evaluate_entry freezes
          // entries with a pending approval, so the queued candidate can't be
          // re-decided on the next tick. The recruiter's Reject resolves it through
          // the human route — which sends the rejection email AND seals the
          // tamper-evident record, so nothing is lost by not applying it here.
          setApproval(
            d.entryId,
            "rejection_review",
            JSON.stringify({
              recommendation: "reject",
              confidence: entrySnap?.matchScore ?? null,
              rationale: d.reason,
            }),
            entryWs
          );
          d.outcome = "queued";
          d.reason = `Queued for approval: ${d.reason}`;
          summary.held += 1; // routed to the human Decisions gate, not actioned
        }
      } else if (d.action === "hold") {
        summary.held += 1;
        d.outcome = "applied";
      }
      for (const alert of d.alerts ?? []) {
        if (!hasEventToday(d.entryId, alert, entryWs)) {
          recordAutomationEvent(d.entryId, alert, d.reason, entryWs);
          summary.alerts += 1;
        }
      }
      } catch (applyError) {
        // A reject's DB transition may already be committed (rejected count stands);
        // a post-commit comm failure is recorded here and the pass continues rather
        // than aborting. The errors count surfaces the partial in the run summary.
        summary.errors += 1;
        const reason = applyError instanceof Error ? applyError.message : String(applyError);
        d.outcome = "failed";
        d.reason = `Apply failed: ${reason}. Original policy decision: ${d.reason}`;
        console.error(`[automation-pass] decision apply failed for ${d.entryId}: ${reason}`);
      }
    }

    return { summary, decisions };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
