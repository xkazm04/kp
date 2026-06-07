import { writeFile } from "node:fs/promises";
import path from "node:path";
import { actOnPipelineEntry, hasEventToday, listActiveEntriesForAutomation, recordAutomationEvent } from "./db";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { dispatchRejection } from "./comms-dispatch";
import { assertAutoRejectFair } from "./automation-fairness";

// Audit event kind logged when the TS fairness backstop refuses a Python reject
// and downgrades it to a hold. A non-zero count here means an upstream regression
// tried to auto-reject an entry the fairness invariant protects — see
// automation-fairness.ts (assertAutoRejectFair).
export const FAIRNESS_BLOCKED_REJECT_ALERT = "fairness_gate_blocked_reject";

// Task 7 — deterministic policy pass over all active entries. LLM-free. Extracted
// from the route so it has ONE home shared by /api/automation/run (the button +
// any external cron) and the in-process scheduler clock (instrumentation.ts).

export type AutomationDecision = {
  entryId: string;
  action: "advance" | "reject" | "hold" | "none";
  toStage: string | null;
  alerts: string[];
  reason: string;
};
export type AutomationSummary = { advanced: number; rejected: number; held: number; alerts: number };
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

export function runAutomationPass(): Promise<AutomationPassResult> {
  if (inFlightPass) return inFlightPass;
  inFlightPass = executeAutomationPass().finally(() => {
    inFlightPass = null;
  });
  return inFlightPass;
}

async function executeAutomationPass(): Promise<AutomationPassResult> {
  const entries = listActiveEntriesForAutomation();
  const summary: AutomationSummary = { advanced: 0, rejected: 0, held: 0, alerts: 0 };
  if (entries.length === 0) return { summary, decisions: [] };

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
    for (const d of decisions) {
      if (!d.entryId) continue;
      // Optimistic CAS (idea-b6310b92): the policy decided against the SNAPSHOT
      // stage, but the Python hop takes seconds — a recruiter (or a concurrent
      // pass) may have moved the entry meanwhile. Passing expectedStage makes a
      // stale verdict a logged no-op instead of an action applied to whatever
      // stage the entry happens to be in NOW.
      const snapshotStage = byId.get(d.entryId)?.stage;
      if (d.action === "advance") {
        const applied = actOnPipelineEntry(d.entryId, "accept", undefined, { expectedStage: snapshotStage }); // logs `advanced` + stamps stage_changed_at
        if (applied) {
          summary.advanced += 1;
        } else {
          d.action = "none";
          d.reason = `Skipped: stage changed mid-pass. Original policy decision: ${d.reason}`;
        }
      } else if (d.action === "reject") {
        // Defense in depth: re-assert the fairness invariant before applying a
        // reject (BAU<40 only — enforced in evaluate_entry). If Python regressed and
        // emitted a reject for a protected/unscored/at-or-above-floor entry, REFUSE
        // it — downgrade to a hold + alert rather than silently auto-rejecting.
        const verdict = assertAutoRejectFair(byId.get(d.entryId));
        if (verdict.allowed) {
          const rejected = actOnPipelineEntry(d.entryId, "reject", undefined, { expectedStage: snapshotStage });
          if (rejected) {
            await dispatchRejection(rejected, { automated: true }); // tell the candidate (queued by default)
            summary.rejected += 1;
          } else {
            // Stale (stage changed mid-pass) — and crucially, NO rejection email
            // went out for a verdict the entry's current state never earned.
            d.action = "none";
            d.reason = `Skipped: stage changed mid-pass. Original policy decision: ${d.reason}`;
          }
        } else {
          d.action = "hold";
          d.reason = `Auto-reject refused by fairness backstop: ${verdict.reason}. Original policy decision: ${d.reason}`;
          // Surface it as an alert; the loop below records it (deduped per day) and
          // counts it, so the refusal shows up in the Activity feed for audit.
          d.alerts = (d.alerts ?? []).includes(FAIRNESS_BLOCKED_REJECT_ALERT)
            ? d.alerts
            : [...(d.alerts ?? []), FAIRNESS_BLOCKED_REJECT_ALERT];
          summary.held += 1; // routed to the human Decisions gate, not actioned
        }
      } else if (d.action === "hold") {
        summary.held += 1;
      }
      for (const alert of d.alerts ?? []) {
        if (!hasEventToday(d.entryId, alert)) {
          recordAutomationEvent(d.entryId, alert, d.reason);
          summary.alerts += 1;
        }
      }
    }

    return { summary, decisions };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}
