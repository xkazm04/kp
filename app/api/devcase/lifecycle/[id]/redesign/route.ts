import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { meterGate, recordMeterUsage } from "@/app/_lib/billing";
import { updateLifecycle } from "@/app/_lib/db/devcase";
// The shared by-id owner guard (sibling module - a route file may export only handlers).
import { ownedLifecycle } from "../../../devcase-owned-lifecycle";
import { runDesignArtifacts } from "@/app/_lib/devcase-run";
import { isAtReviewGate } from "@/app/_lib/devcase-orchestrator";
import { recordAudit } from "@/app/_lib/dev-control";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import type { DevNeed } from "@/app/_lib/devcase-run";

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

    // OWNERSHIP, resolved once and reused by the billing gate below. This route used to
    // load the lifecycle by id with no comparison at all and then debit the CALLER's
    // `case_designs` meter for a design pass that rewrote another studio's brief - the
    // cross-tenant write and the misbilling were the same bug. A cross-tenant id now
    // answers the same 404 a nonexistent one does.
    const workspace = await currentWorkspace();
    const lc = ownedLifecycle(id, workspace);
    if (!lc) return NextResponse.json({ error: "lifecycle not found" }, { status: 404 });
    if (!isAtReviewGate(lc.stage)) {
      return NextResponse.json({ error: `lifecycle is at '${lc.stage}', not awaiting review.` }, { status: 409 });
    }
    if (!lc.need || !lc.analysis) {
      return NextResponse.json({ error: "lifecycle is missing its need/analysis artifacts." }, { status: 409 });
    }
    // Billing: a redesign is a fresh design generation — gate + debit like one.
    // Org attribution (org-plan Phase 3): gate + debit read the caller's tenant - the very
    // one the ownership guard above already proved owns this lifecycle.
    const quota = meterGate("case_designs", { workspace });
    if (quota) return jsonRefusal("BILLING_QUOTA_EXCEEDED", 402, { meter: quota.meter, plan: quota.plan });
    recordMeterUsage("case_designs", 1, new Date(), workspace);

    // DEVP5 — a redesign keeps the lifecycle's candidate-facing language.
    const designed = await runDesignArtifacts(lc.need as DevNeed, lc.analysis, undefined, feedback, lc.lang);
    // RE-CHECK THE GATE. The design call above is a ~60s await (maxDuration), so the
    // pre-check that guarded it is stale — a check-then-act window, the same defect class
    // the close route's claimLifecycleClose closed. If a second tab or a second reviewer
    // on the shared gate queue approved during the run, `lc.case` is already frozen into
    // dev_cases and published; writing this newer design over the lifecycle would leave
    // the studio rendering a case NO candidate was given, under a detail claiming it still
    // awaits approval. Refuse instead, with the same 409-plus-current-stage shape the
    // approve route uses for off-gate edits. Nothing awaits between this read and the
    // write below, so the re-check cannot itself go stale.
    // Re-read through the SAME owner guard: ownership cannot change mid-request, and
    // routing every read of this row through one producer is the point of the helper.
    const current = ownedLifecycle(id, workspace);
    if (!current || !isAtReviewGate(current.stage)) {
      recordAudit({
        lifecycleId: id,
        actor: "human",
        action: "redesign_discarded",
        reason: `approved/advanced elsewhere during the redesign (stage '${current?.stage ?? "missing"}')`,
      });
      return NextResponse.json(
        {
          error: `lifecycle is at '${current?.stage ?? "gone"}', not awaiting review — the regenerated design was not saved.`,
          stage: current?.stage ?? null,
        },
        { status: 409 }
      );
    }
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
    // runDesignArtifacts spawns the devcase CLI: the thrown message carries Python
    // tracebacks and provider stderr as well as SQLITE_* store detail.
    return safeJsonError(error, "api:devcase/lifecycle/redesign", "DEVCASE_REDESIGN_FAILED");
  }
}
