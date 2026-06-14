import { NextRequest, NextResponse } from "next/server";
import { activePromoteFloor } from "@/app/_lib/devcase-orchestrator";
import { recordAudit, setPromoteFloor } from "@/app/_lib/dev-control";
import { calibrate, listOutcomes, outcomeInputSchema, recordOutcome } from "@/app/_lib/dev-outcomes";

export const runtime = "nodejs";

const activeFloor = activePromoteFloor;

// Direction E — the outcome loop: record what happened + read the calibration.
export async function GET() {
  try {
    return NextResponse.json({ outcomes: listOutcomes(), calibration: calibrate(activeFloor()), activeFloor: activeFloor() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    recordOutcome(outcome);
    recordAudit({ actor: "human", action: "outcome_recorded", reason: `${outcome.candidateRef ?? "candidate"}: ${outcome.outcome}${outcome.performance ? ` (perf ${outcome.performance})` : ""}` });
    return NextResponse.json({ ok: true, calibration: calibrate(activeFloor()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 500 });
  }
}
