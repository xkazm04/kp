import { NextRequest, NextResponse } from "next/server";
import { DEV_POLICY } from "@/app/_lib/devcase-orchestrator";
import { getPromoteFloor, recordAudit, setPromoteFloor } from "@/app/_lib/dev-control";
import { calibrate, listOutcomes, recordOutcome } from "@/app/_lib/dev-outcomes";

export const runtime = "nodejs";

const activeFloor = () => getPromoteFloor() ?? DEV_POLICY.promoteFloor;

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
      setPromoteFloor(body.setFloor);
      recordAudit({ actor: "human", action: "set_promote_floor", reason: `floor → ${Math.round(body.setFloor)} (from calibration)` });
      return NextResponse.json({ activeFloor: activeFloor() });
    }

    if (!body.outcome) return NextResponse.json({ error: "outcome is required (hired|rejected|withdrawn)." }, { status: 400 });
    recordOutcome({
      ref: body.ref,
      candidateRef: body.candidateRef,
      predictedScore: body.predictedScore,
      outcome: body.outcome,
      performance: body.performance,
      note: body.note,
    });
    recordAudit({ actor: "human", action: "outcome_recorded", reason: `${body.candidateRef ?? "candidate"}: ${body.outcome}${body.performance ? ` (perf ${body.performance})` : ""}` });
    return NextResponse.json({ ok: true, calibration: calibrate(activeFloor()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed." }, { status: 500 });
  }
}
