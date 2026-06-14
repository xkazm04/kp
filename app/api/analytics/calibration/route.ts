import { NextResponse } from "next/server";
import { calibrationPairs } from "@/app/_lib/db";
import { computeCalibration } from "@/app/_lib/calibration";
import { jsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Calibration Engine (moonshot A/C, foundational primitive P1) — exposes the
// MEASURED reliability of the fit score: the (score, advance/pass-outcome) pairs
// from saved analyses, binned into a reliability curve + Brier score + an
// honest "calibrated since N outcomes" gate. ?roleFamily filters to one family
// so a buyer can ask "how accurate are you for backend roles?". Read-only.
export async function GET(request: Request) {
  try {
    const roleFamily = new URL(request.url).searchParams.get("roleFamily");
    let pairs = calibrationPairs();
    if (roleFamily) {
      pairs = pairs.filter((p) => p.roleFamily === roleFamily);
    }
    return NextResponse.json(computeCalibration(pairs));
  } catch (error) {
    // calibrationPairs() reads every saved-analysis row, so a transient DB fault
    // (locked mid-write, corrupt file, migration race) surfaces here. Match the
    // sibling analytics routes: log with context + structured 500, never a bare crash.
    return jsonError(error, "Failed to compute calibration.");
  }
}
