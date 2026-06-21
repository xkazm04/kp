import { NextRequest, NextResponse } from "next/server";
import { AutomationError, runAutomationTask } from "@/app/_lib/automation-run";
import { requireOperator } from "@/app/_lib/auth/require-operator";

export const runtime = "nodejs";

// Synchronous convenience wrapper. The hardened/background path is /api/tasks
// with kind "automation" (tracked, dedup'd, refresh-safe); both share runAutomationTask.
export async function POST(request: NextRequest, context: { params: Promise<{ task: string }> }) {
  // Defense-in-depth: runs a per-entry automation task (LLM spend + outreach side
  // effects) — operator-only, like the bulk pass route.
  const denied = await requireOperator();
  if (denied) return denied;
  const { task } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { entryId?: string; notes?: string };
    if (!body.entryId) return NextResponse.json({ error: "entryId required" }, { status: 400 });
    const out = await runAutomationTask(body.entryId, task, typeof body.notes === "string" ? body.notes : "");
    return NextResponse.json(out);
  } catch (error) {
    if (error instanceof AutomationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Automation task failed." }, { status: 500 });
  }
}
