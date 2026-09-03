import { NextResponse } from "next/server";
import { AutomationPassError, isPassInFlight, runAutomationPass } from "@/app/_lib/automation-pass";
import { decisionsForWorkspace, recordRun } from "@/app/_lib/scheduler-store";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


// Task 7 — deterministic policy pass over all active entries. LLM-free.
// The core lives in automation-pass.ts so the scheduler clock runs the exact
// same logic; an external cron can also hit this endpoint on a timer.
// AUTO3: `{"dryRun": true}` previews the identical decisions without applying,
// dispatching, or writing anything — the look-before-commit gate.
export async function POST(request: Request) {
  // Defense-in-depth beyond the proxy gate: a pass spends LLM budget, dispatches
  // candidate outreach, and mutates the pipeline board — strictly an operator action
  // (mirrors the requireOperator guard on the other Python-spawning routes).
  const denied = await requireOperator();
  if (denied) return denied;
  // AUTHORIZATION (write-routes-check-a-capability). requireOperator above only
  // proves a trusted session is present — in open mode it is true for everyone —
  // so it is identity, never authority. This write is a recruiter operation: ask
  // the seat for `pipeline:write`, so a viewer is refused with a code instead of
  // silently mutating the board.
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  const body = (await request.json().catch(() => ({}))) as { dryRun?: unknown };
  const dryRun = body.dryRun === true;
  // TENANCY (phase 1): the sweep is global by design and the run log keeps the FULL
  // decision list (it is the installation's audit record) — but the RESPONSE only
  // ever hands this caller their own team's rows, so a preview or a committed pass
  // can't ship another tenant's candidate labels and rejection reasons to the
  // browser. `summary` stays the global count of what the pass actually did; it is
  // labeled as such by `decisionsWorkspace` + `workspaceDecisionCount` beside it.
  // Resolved BEFORE the in-flight check below — see why there.
  const workspace = await currentWorkspace();
  // AUTO2 — a committed run from this route (the board's "Run pass" button /
  // an external cron) is durably recorded like the clock's: when this call JOINS an
  // in-flight pass, whoever started it records it — never twice.
  // This MUST be the last thing before runAutomationPass, with NO await in between
  // (the invariant tickScheduler states and honors). runAutomationPass fills the
  // single-flight slot synchronously, so a suspension here — `await
  // currentWorkspace()` used to sit in this gap, awaiting cookies() + connection() —
  // lets two concurrent POSTs both read "nothing in flight", both continue, one start
  // the pass and the other join it, and BOTH write a scheduler_runs row for the one
  // executed pass. Pinned by route.test.ts.
  const joined = isPassInFlight();
  const startedAt = new Date().toISOString();
  try {
    const { summary, decisions } = await runAutomationPass({ dryRun });
    if (!dryRun && !joined) recordRun({ status: "ok", summary, decisions, startedAt, trigger: "manual" });
    const visible = decisionsForWorkspace(decisions, workspace) as typeof decisions;
    return NextResponse.json({
      summary,
      decisions: visible,
      decisionsWorkspace: workspace,
      workspaceDecisionCount: visible.length,
      dryRun,
    });
  } catch (error) {
    const status = error instanceof AutomationPassError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Automation pass failed.";
    if (!dryRun && !joined) recordRun({ status: "error", error: message, startedAt, trigger: "manual" });
    return NextResponse.json({ error: message }, { status });
  }
}
