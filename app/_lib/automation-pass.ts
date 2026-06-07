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

export async function runAutomationPass(): Promise<AutomationPassResult> {
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
      if (d.action === "advance") {
        actOnPipelineEntry(d.entryId, "accept"); // logs `advanced` + stamps stage_changed_at
        summary.advanced += 1;
      } else if (d.action === "reject") {
        // Defense in depth: re-assert the fairness invariant before applying a
        // reject (BAU<40 only — enforced in evaluate_entry). If Python regressed and
        // emitted a reject for a protected/unscored/at-or-above-floor entry, REFUSE
        // it — downgrade to a hold + alert rather than silently auto-rejecting.
        const verdict = assertAutoRejectFair(byId.get(d.entryId));
        if (verdict.allowed) {
          const rejected = actOnPipelineEntry(d.entryId, "reject");
          if (rejected) await dispatchRejection(rejected, { automated: true }); // tell the candidate (queued by default)
          summary.rejected += 1;
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
