import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getJob } from "./db/jobs";
import { actOnPipelineEntry, hasEventSinceStageChange, hasEventToday, listActiveEntriesForAutomation, recordAutomationEvent, setApproval, setEntryMatchScore, type AutomationEntry } from "./db/pipeline";
import { resolveCandidatePoolEntry } from "./candidate-pool";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, PipelineError, pythonSpawnLoad, spawnPython } from "./python-runner";
import { positiveNumericEnv } from "./env";
import { rankPoolForJob } from "./recruiter-run";
import { assertAutoRejectFair, type AutoRejectVerdict } from "./automation-fairness";
import { FAIRNESS_GATE_BLOCKED_REJECT, type DecisionOutcome } from "./decision-attribution";
import { isAgingAlertKind } from "./aging-policy";

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
// docs/features/pipeline/README.md §risks). On an allowed verdict it does nothing and
// returns false; on a refused verdict it downgrades the decision to a hold,
// rewrites the reason, appends the dedup alert, bumps `summary.held`, and returns
// true. `preview` selects only the "would be refused" vs "refused" wording so a
// dry run reads as a forecast while the commit reads as an applied refusal —
// every other byte is identical across the two callers.
/** The four wrapper sentences this module composes around a policy decision.
 *  Each maps to `decisions.pass.reasons.<code>` in the catalog. */
export type PassReasonCode =
  | "staleSkip"
  | "queuedForApproval"
  | "wouldBeQueuedForApproval"
  | "fairnessRefused"
  | "fairnessWouldRefuse"
  | "applyFailed";

// Optimistic-CAS stale handling, shared by the advance and reject apply branches:
// when actOnPipelineEntry refuses because the snapshot stage no longer holds (a
// recruiter or concurrent pass moved the entry during the Python hop), turn the
// decision into a no-op and record WHY, instead of acting on whatever stage the
// entry is in now. The single encoding so both stale branches skip identically.
function markStaleSkip(d: AutomationDecision): void {
  d.action = "none";
  d.outcome = "skipped";
  d.reasonCode = "staleSkip";
  d.reasonParams = { original: d.reason };
  d.reason = `Skipped: stage changed mid-pass. Original policy decision: ${d.reason}`;
}

// THE single encoding of "a fairness-cleared reject is ROUTED TO THE HUMAN gate,
// never applied", shared by the dry-run preview loop and the commit loop — the
// same write-once trick applyFairnessVerdict uses for the refusal path, and for
// the same reason: the preview must forecast exactly what the commit produces.
// Both callers get outcome "queued" and `summary.held += 1`; `summary.rejected`
// is incremented by NEITHER, because the pass no longer produces a rejection.
// `preview` selects only the "would be queued" vs "queued" wording. The commit
// caller additionally writes the rejection_review approval (a dry run writes
// nothing) — that side effect is the ONLY difference between the two paths.
export function markQueuedForApproval(d: AutomationDecision, summary: AutomationSummary, preview: boolean): void {
  d.outcome = "queued";
  d.reasonCode = preview ? "wouldBeQueuedForApproval" : "queuedForApproval";
  d.reasonParams = { original: d.reason };
  d.reason = `${preview ? "Would be queued" : "Queued"} for approval: ${d.reason}`;
  summary.held += 1;
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
  d.reasonCode = preview ? "fairnessWouldRefuse" : "fairnessRefused";
  d.reasonParams = { verdict: verdict.reason, original: d.reason };
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
  /** Structured mirror of `reason`, so the UI can render the wrapper sentence in
   *  the reader's language. `reason` stays canonical English: it is sealed into
   *  the decision record and read back by exporters and auditors, and
   *  deriveDecisionOutcome still parses its prefix for rows written before
   *  `outcome` existed. Same split screen-wave.ts already uses (reasonCode +
   *  reasonParams → `decisions.wave.reasons.*`); the UI falls back to `reason`
   *  when a legacy row carries no code. */
  reasonCode?: PassReasonCode;
  reasonParams?: Record<string, string | number>;
  /** The tenant this decision belongs to — the entry's OWN workspace, stamped by
   *  executeAutomationPass from the snapshot (Python never sees it). The pass is a
   *  deliberate GLOBAL sweep, so one run's decision list spans teams; this is what
   *  lets every READ of that list (scheduler-store.listRuns, /api/automation/run)
   *  hand a caller only their own rows instead of leaking other tenants' candidate
   *  labels and rejection reasons. Absent only on rows persisted before the stamp
   *  existed — those are attributed to the default workspace on read. */
  workspaceId?: string;
};
// `evaluated` = how many active entries the pass actually scanned. It distinguishes a
// healthy idle pass (evaluated N, 0 actions) from a pass that saw NOTHING (evaluated 0 —
// empty/terminal board, or a status-filter regression), which otherwise both logged an
// all-zero "ok" run — the exact success-theater the orchestration status surface should prevent.
// `rejected` is structurally 0 since unattended auto-reject was retired (UAT M6 /
// GDPR Art. 22): a fairness-cleared reject is QUEUED as a held rejection_review,
// counted in `held`. The field is kept because scheduler_runs rows persisted before
// the retirement carry real values, and the run history must still read them. Neither
// the preview nor the commit increments it — that parity is the point.
export type AutomationSummary = {
  advanced: number;
  rejected: number;
  held: number;
  alerts: number;
  errors: number;
  evaluated: number;
  /** Job groups the pre-policy scoring sweep did not reach because the pass's total
   *  spawn budget was spent. Absent when the budget did not fire, so a persisted
   *  summary from before the budget existed reads identically. Optional rather than
   *  zero-filled for that reason. */
  scoringDeferred?: number;
};
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

// How many sequential rounds of the interpreter ceiling one scheduled pass may
// spend on scoring. The budget below is this times the ceiling, so raising the
// machine's capacity raises the sweep's allowance with it instead of leaving it
// pinned at a number somebody typed once.
const SCORING_ROUNDS_PER_PASS = 8;

/** The TOTAL paid interpreters one scoring sweep may issue, DERIVED from the
 *  process-wide admission ceiling (`KP_PYTHON_MAX_CONCURRENT`, python-runner) rather
 *  than typed beside it.
 *
 *  Why a second number at all: the admission semaphore is a STOCK cap, released on
 *  settle, and this sweep is sequential — it never holds more than one slot, so the
 *  ceiling can never fire on it however low it is set. The ceiling bounds the machine
 *  at an instant; nothing bounded what one pass may spend, and the sweep's length is
 *  read out of the database at run time (distinct jobs with unscored entries, across
 *  every workspace), not enumerated in code.
 *
 *  `KP_AUTOMATION_SCORING_SPAWNS_MAX` overrides the derivation for an operator who
 *  wants a flat allowance. */
export function scoringSpawnBudget(): number {
  const derived = pythonSpawnLoad().ceiling * SCORING_ROUNDS_PER_PASS;
  return Math.max(1, Math.floor(positiveNumericEnv("KP_AUTOMATION_SCORING_SPAWNS_MAX", derived)));
}

/** Admission for a sequential sweep whose work list is re-derived every pass.
 *
 *  `scoreGroup` returns whether it actually issued a paid interpreter, so the budget
 *  counts spawns and not iterations — a group with no resolvable candidate costs
 *  nothing and must not consume the allowance.
 *
 *  The groups past the budget are DEFERRED, never dropped, and that is only safe
 *  because an admitted group's work LEAVES the work list: the score is persisted, so
 *  the filter that builds the next pass's list no longer selects it and the next pass
 *  starts where this one stopped. Over a list that is re-derived identically each
 *  pass, the same prefix would be admitted forever and the tail would starve — so a
 *  total cap needs persisted progress in a way a concurrency cap does not, because
 *  the concurrency cap only ever delays the work it refuses. */
export async function runScoringSweep<G>(
  groups: Iterable<[string, G]>,
  budget: number,
  scoreGroup: (jobId: string, group: G) => Promise<boolean>,
): Promise<{ spawned: number; deferred: number }> {
  let spawned = 0;
  let deferred = 0;
  for (const [jobId, group] of groups) {
    if (spawned >= budget) {
      deferred += 1;
      continue;
    }
    if (await scoreGroup(jobId, group)) spawned += 1;
  }
  return { spawned, deferred };
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
async function scoreUnscoredEntries(entries: AutomationEntry[], dryRun: boolean): Promise<number> {
  // The "ds-" exclusion is a LEGACY carve-out, not a rule about dev-case candidates:
  // a synthetic "ds-<submissionId>" id has no `profiles` row, so the pool lookup can
  // only miss. Since the one-thread milestone a promoted submission carries a REAL
  // profile id (devcase-run.promoteSubmission), so those entries now pass this filter
  // and get scored like anyone else — which is the point: they were unrankable before.
  const unscored = entries.filter(
    (e) => e.matchScore == null && !e.intakeDegraded && e.candidateId && e.jobId && !e.candidateId.startsWith("ds-")
  );
  if (unscored.length === 0) return 0;

  // Group by job — one recruiter_cli spawn scores all of a job's newcomers.
  const byJob = new Map<string, AutomationEntry[]>();
  for (const e of unscored) {
    const list = byJob.get(e.jobId as string) ?? [];
    list.push(e);
    byJob.set(e.jobId as string, list);
  }

  const { deferred } = await runScoringSweep(byJob, scoringSpawnBudget(), async (jobId, group) => {
    let issued = false;
    try {
      const candidates = group
        // Each entry resolves within its OWN workspace — the global sweep spans
        // tenants, so a candidate must never resolve against another team's store.
        .map((e) => resolveCandidatePoolEntry(e.candidateId as string, e.candidateLabel, e.workspaceId))
        .filter((c): c is NonNullable<typeof c> => c !== null);
      if (candidates.length === 0) return false;

      // Pass the DB job directly when it exists, so ingested (non-corpus) jobs
      // score too — same contract as the candidates route. A CLI failure throws a
      // PipelineError, caught below so the bad job is skipped and the sweep
      // continues (the entry stays held exactly as before).
      const job = getJob(jobId);
      issued = true;
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
    return issued;
  });

  // The stop is recorded, never silent: a pass that leaves jobs unscored says so,
  // and the count is what tells an operator whether the derived budget is binding
  // every pass (raise the ceiling) or never (the bound is not the constraint).
  if (deferred > 0) {
    console.warn(
      `[automation-pass] scoring budget reached: ${deferred} job group(s) deferred to the next pass ` +
        `(budget ${scoringSpawnBudget()} spawns/pass, derived from the interpreter ceiling ${pythonSpawnLoad().ceiling})`,
    );
  }
  return deferred;
}

/** Write (or, on a dry run, count) one decision's alerts — the SINGLE encoding the
 *  preview loop and the commit loop share, so the forecast and the feed agree.
 *
 *  Two dedupe windows, by kind:
 *  - the aging alerts (`stale_alert` = past the stage SLA, `aging_alert` = stalled at
 *    STALLED_MULTIPLE x the SLA; aging-policy.ts) are written ONCE per stage stint per
 *    tier, keyed on the snapshot's `stageChangedAt`. A per-business-day key re-wrote the
 *    same "still waiting" line into the feed every day until someone moved the card.
 *  - every other alert (the fairness backstop's `fairness_gate_blocked_reject`) keeps
 *    its per-business-day dedupe: each refusal is a fresh event worth surfacing daily.
 *
 *  An aging alert on an ADVANCE decision (or on a staleSkip, where the entry moved
 *  mid-pass) is dropped: the move ends the stint the alert describes, and a row
 *  written after the move would sit inside the NEW stint and suppress that stint's
 *  own first alert. */
export function recordDecisionAlerts(
  d: AutomationDecision,
  entrySnap: AutomationEntry | undefined,
  summary: AutomationSummary,
  dryRun: boolean
): void {
  if (!d.entryId) return;
  const ws = entrySnap?.workspaceId;
  for (const alert of d.alerts ?? []) {
    const aging = isAgingAlertKind(alert);
    // The stint is over (or already moved under us, a staleSkip): not this stint's alert.
    if (aging && (d.action === "advance" || d.reasonCode === "staleSkip")) continue;
    const already = aging
      ? hasEventSinceStageChange(d.entryId, alert, entrySnap?.stageChangedAt ?? null, ws)
      : hasEventToday(d.entryId, alert, ws);
    if (already) continue;
    if (!dryRun) recordAutomationEvent(d.entryId, alert, d.reason, ws);
    summary.alerts += 1;
  }
}

async function executeAutomationPass(dryRun: boolean): Promise<AutomationPassResult> {
  const entries = listActiveEntriesForAutomation();
  const summary: AutomationSummary = { advanced: 0, rejected: 0, held: 0, alerts: 0, errors: 0, evaluated: entries.length };
  if (entries.length === 0) return { summary, decisions: [] };

  // AUTO1 — score the unscored BEFORE the policy step, so an inbound applicant
  // is triaged on this very pass instead of held "awaiting match score" forever.
  const scoringDeferred = await scoreUnscoredEntries(entries, dryRun);
  if (scoringDeferred > 0) summary.scoringDeferred = scoringDeferred;

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

    // TENANCY (phase 1) — stamp each decision with its entry's own workspace, in ONE
    // place, before either branch below can return or persist the list. The sweep
    // itself stays global by design (listActiveEntriesForAutomation), but a decision
    // row carries a candidate label and a rejection reason, so every reader of the
    // list (the run log, the dry-run preview) must be able to filter it to the asking
    // tenant. Python computes the verdict and never sees a workspace; the snapshot is
    // the only authority for it.
    for (const d of decisions) {
      const ws = byId.get(d.entryId)?.workspaceId;
      if (ws) d.workspaceId = ws;
    }

    // AUTO3 — dry run: identical snapshot → Python → decisions flow, but the
    // apply/dispatch loop is replaced by annotation. The fairness backstop is
    // still consulted per reject (the preview must show the verdict the commit
    // would actually enforce); nothing is written and no candidate is emailed.
    if (dryRun) {
      for (const d of decisions) {
        if (!d.entryId) continue;
        const entrySnap = byId.get(d.entryId);
        if (d.action === "advance") {
          summary.advanced += 1;
        } else if (d.action === "reject") {
          const verdict = assertAutoRejectFair(entrySnap);
          if (!applyFairnessVerdict(d, verdict, summary, true)) {
            // PREVIEW/COMMIT PARITY: the commit NEVER applies a reject — every
            // fairness-cleared one is queued as a held rejection_review (see the
            // unconditional rule below), so `summary.rejected` is 0 in every
            // committed run. The preview used to forecast `rejected += 1`, an
            // outcome the system can no longer produce: the recruiter was shown N
            // rejections and got 0 rejections + N approval cards. Mirror the
            // commit exactly — the SAME encoding the commit loop calls below.
            markQueuedForApproval(d, summary, true);
          }
        } else if (d.action === "hold") {
          summary.held += 1;
        }
        // Alerts are deduped on commit, so an undeduped preview count over-forecast
        // the alerts a commit would write. Apply the SAME gate through the SAME helper
        // — its dedupe reads are pure, so the dry run stays read-only: it writes no
        // event, it only declines to count one it wouldn't write.
        recordDecisionAlerts(d, entrySnap, summary, true);
      }
      return { summary, decisions };
    }

    // AUTO1 RETIRED (UAT M6 / GDPR Art. 22): a rejection is the one irreversible,
    // candidate-visible ADVERSE action, so the pass NEVER applies it unattended —
    // every fairness-cleared reject is queued for a human on the Decisions gate.
    // Advances, holds and alerts stay autonomous. This is what makes the candidate
    // disclosure's ONE absolute — "a rejection is always a person's: no setting can
    // hand that decision to the machine" (messages/*.json aiDisclosure.body) — true
    // unconditionally; the former opt-in `auto` reject mode is gone. The disclosure
    // used to claim more than this, and the surrounding "nothing adverse is decided
    // automatically" wording was retired with G16 precisely because advance and offer
    // ARE delegable; do not restore an absolute here that only the reject path earns.
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
        // actioned. CLEARED → also not applied: the reject is QUEUED for a human
        // click, unconditionally. There is no mode that applies or emails a reject
        // unattended (the opt-in "auto" mode was retired — see the note above the
        // loop); both branches therefore land on the human Decisions gate and
        // `summary.rejected` is 0 in every committed run.
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
          // Routed to the human Decisions gate, not actioned — the SAME encoding
          // the preview loop uses, so the forecast and the record can't diverge.
          markQueuedForApproval(d, summary, false);
        }
      } else if (d.action === "hold") {
        summary.held += 1;
        d.outcome = "applied";
      }
      recordDecisionAlerts(d, entrySnap, summary, false);
      } catch (applyError) {
        // A decision's DB transition may already be committed (the advance landed,
        // or the rejection_review was queued) when a later step throws; the failure
        // is recorded here and the pass continues rather than aborting. The errors
        // count surfaces the partial in the run summary.
        summary.errors += 1;
        const reason = applyError instanceof Error ? applyError.message : String(applyError);
        d.outcome = "failed";
        d.reasonCode = "applyFailed";
        d.reasonParams = { detail: reason, original: d.reason };
        d.reason = `Apply failed: ${reason}. Original policy decision: ${d.reason}`;
        console.error(`[automation-pass] decision apply failed for ${d.entryId}: ${reason}`);
      }
    }

    return { summary, decisions };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
