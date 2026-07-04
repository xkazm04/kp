import { NextResponse } from "next/server";
import { resetSim } from "@/app/_lib/sim-store";
import { jsonError } from "@/app/_lib/api-response";


// Clear all artifacts from prior simulation runs so the demo re-runs cleanly.
export async function POST() {
  try {
    return NextResponse.json({ ok: true, cleared: resetSim() });
  } catch (error) {
    return jsonError(error, "Reset failed.");
  }
}
