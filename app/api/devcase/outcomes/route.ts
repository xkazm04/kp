import { NextRequest, NextResponse } from "next/server";
import { safeJsonError } from "@/app/_lib/api-response";
import { activePromoteFloor } from "@/app/_lib/devcase-orchestrator";
import { recordAudit, setPromoteFloor } from "@/app/_lib/dev-control";
import { calibrate, listOutcomes, outcomeInputSchema, recordOutcome } from "@/app/_lib/dev-outcomes";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";


const activeFloor = activePromoteFloor;

// Direction E — the outcome loop: record what happened + read the calibration.
// TENANT SCOPE (D5): both are the CALLER'S workspace — the outcome corpus (and so the
// promote-floor recommendation derived from it) is per-team, not deployment-wide. The
// promote FLOOR itself stays global (dev_control is a declared deployment-level table).
export async function GET() {
  // Director gate (2026-09-03): the control room's doors carried no operator check, so a
  // demo cookie could reach them. Identity presence for now; the capability slice follows.
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const ws = await currentWorkspace();
    return NextResponse.json({ outcomes: listOutcomes(80, ws), calibration: calibrate(activeFloor(), ws), activeFloor: activeFloor() });
  } catch (error) {
    return safeJsonError(error, "api:devcase/outcomes", "DEVCASE_OUTCOMES_FAILED");
  }
}

export async function POST(request: NextRequest) {
  // Director gate (2026-09-03): the control room's doors carried no operator check, so a
  // demo cookie could reach them. Identity presence for now; the capability slice follows.
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      setFloor?: number;
      ref?: string;
      candidateRef?: string;
      predictedScore?: number;
      outcome?: string;
      performance?: number;
      note?: string;
    };

    // Apply a calibrated threshold (human action — the loop stays human-in-the-loop).
    if (typeof body.setFloor === "number") {
      // typeof NaN/Infinity === "number" — reject non-finite before it reaches the store,
      // where it would stringify to "NaN", read back as null, and silently fall back to the
      // default floor while the audit log claims a calibration that never took effect.
      if (!Number.isFinite(body.setFloor)) {
        return NextResponse.json({ error: "setFloor must be a finite number (0–100)." }, { status: 400 });
      }
      setPromoteFloor(body.setFloor);
      recordAudit({ actor: "human", action: "set_promote_floor", reason: `floor → ${Math.round(body.setFloor)} (from calibration)` });
      return NextResponse.json({ activeFloor: activeFloor() });
    }

    // Validate the outcome against the canonical vocabulary + 1..5 hired-only perf scale at
    // this boundary, so a typo'd label or stray performance score can never reach the
    // calibration store and silently bias the promote-floor suggestion.
    const parsed = outcomeInputSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid outcome payload.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const outcome = parsed.data;
    const ws = await currentWorkspace();
    recordOutcome(outcome, ws);
    recordAudit({ actor: "human", action: "outcome_recorded", reason: `${outcome.candidateRef ?? "candidate"}: ${outcome.outcome}${outcome.performance ? ` (perf ${outcome.performance})` : ""}` });
    return NextResponse.json({ ok: true, calibration: calibrate(activeFloor(), ws) });
  } catch (error) {
    // The POST records an outcome and re-runs calibration over the store.
    return safeJsonError(error, "api:devcase/outcomes", "DEVCASE_OUTCOME_SAVE_FAILED");
  }
}
