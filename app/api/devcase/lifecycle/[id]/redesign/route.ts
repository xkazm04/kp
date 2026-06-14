import { NextResponse } from "next/server";
import { meterGate, recordMeterUsage } from "@/app/_lib/billing";
import { getLifecycle, updateLifecycle } from "@/app/_lib/db";
import { runDesignArtifacts } from "@/app/_lib/devcase-run";
import { isAtReviewGate } from "@/app/_lib/devcase-orchestrator";
import { recordAudit } from "@/app/_lib/dev-control";
import type { DevNeed } from "@/app/_lib/devcase-run";

export const runtime = "nodejs";
// One LLM design pass — same budget the github deep-dive route runs under.
export const maxDuration = 60;

const MAX_FEEDBACK_CHARS = 2000;

// W5-4 (DEVP1) — "Regenerate with note" at the human approval gate. The gate
// used to be take-it-or-leave-it: a flawed design forced a full lifecycle
// re-run from intake, discarding the reviewer's diagnosis. This re-runs ONLY
// the design step with the reviewer's feedback appended to the design prompt
// (devcase_cli --feedback), and keeps the lifecycle at awaiting_approval so
// the revised case comes back to the same human gate.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { feedback?: unknown };
    const feedback = typeof body.feedback === "string" ? body.feedback.trim().slice(0, MAX_FEEDBACK_CHARS) : "";
    if (!feedback) return NextResponse.json({ error: "feedback is required." }, { status: 400 });

    const lc = getLifecycle(id);
    if (!lc) return NextResponse.json({ error: "lifecycle not found" }, { status: 404 });
    if (!isAtReviewGate(lc.stage)) {
      return NextResponse.json({ error: `lifecycle is at '${lc.stage}', not awaiting review.` }, { status: 409 });
    }
    if (!lc.need || !lc.analysis) {
      return NextResponse.json({ error: "lifecycle is missing its need/analysis artifacts." }, { status: 409 });
    }
    // Billing: a redesign is a fresh design generation — gate + debit like one.
    const quota = meterGate("case_designs");
    if (quota) return NextResponse.json(quota, { status: 402 });
    recordMeterUsage("case_designs");

    // DEVP5 — a redesign keeps the lifecycle's candidate-facing language.
    const designed = await runDesignArtifacts(lc.need as DevNeed, lc.analysis, undefined, feedback, lc.lang);
    updateLifecycle(id, {
      role: designed.role,
      case: designed.case,
      detail: "redesigned with reviewer feedback — awaiting approval",
    });
    recordAudit({
      lifecycleId: id,
      actor: "human",
      action: "redesign_requested",
      reason: feedback.slice(0, 160),
    });
    return NextResponse.json({ ok: true, role: designed.role, case: designed.case, source: designed.source });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Redesign failed." }, { status: 500 });
  }
}
