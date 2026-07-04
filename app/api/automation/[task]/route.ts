import { NextRequest, NextResponse } from "next/server";
import { AutomationError, runAutomationTask } from "@/app/_lib/automation-run";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { getServerLocale } from "@/i18n/server";


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
    // On-demand (recruiter-initiated) run: pass the recruiter's UI locale so the
    // recruiter-narrative tasks (screen/prep/scorecard) render in the org language.
    // Background/task-runner paths pass none → runAutomationTask falls back to the
    // workspace default.
    const lang = await getServerLocale();
    const out = await runAutomationTask(body.entryId, task, typeof body.notes === "string" ? body.notes : "", undefined, lang);
    return NextResponse.json(out);
  } catch (error) {
    if (error instanceof AutomationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Automation task failed." }, { status: 500 });
  }
}
