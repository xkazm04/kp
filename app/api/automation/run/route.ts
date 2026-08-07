import { NextResponse } from "next/server";
import { AutomationPassError, isPassInFlight, runAutomationPass } from "@/app/_lib/automation-pass";
import { recordRun } from "@/app/_lib/scheduler-store";
import { requireOperator } from "@/app/_lib/auth/require-operator";


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
  const body = (await request.json().catch(() => ({}))) as { dryRun?: unknown };
  const dryRun = body.dryRun === true;
  // AUTO2 — a committed run from this route (the board's "Run pass" button /
  // an external cron) is durably recorded like the clock's, so the run
  // history is complete. Captured synchronously: when this call JOINS an
  // in-flight pass, whoever started it records it — never twice.
  const joined = isPassInFlight();
  const startedAt = new Date().toISOString();
  try {
    const { summary, decisions } = await runAutomationPass({ dryRun });
    if (!dryRun && !joined) recordRun({ status: "ok", summary, decisions, startedAt, trigger: "manual" });
    return NextResponse.json({ summary, decisions, dryRun });
  } catch (error) {
    const status = error instanceof AutomationPassError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Automation pass failed.";
    if (!dryRun && !joined) recordRun({ status: "error", error: message, startedAt, trigger: "manual" });
    return NextResponse.json({ error: message }, { status });
  }
}
