import { NextResponse } from "next/server";
import { AutomationPassError, runAutomationPass } from "@/app/_lib/automation-pass";

export const runtime = "nodejs";

// Task 7 — deterministic policy pass over all active entries. LLM-free.
// The core lives in automation-pass.ts so the scheduler clock runs the exact
// same logic; an external cron can also hit this endpoint on a timer.
// AUTO3: `{"dryRun": true}` previews the identical decisions without applying,
// dispatching, or writing anything — the look-before-commit gate.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { dryRun?: unknown };
    const dryRun = body.dryRun === true;
    const { summary, decisions } = await runAutomationPass({ dryRun });
    return NextResponse.json({ summary, decisions, dryRun });
  } catch (error) {
    const status = error instanceof AutomationPassError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Automation pass failed.";
    return NextResponse.json({ error: message }, { status });
  }
}
