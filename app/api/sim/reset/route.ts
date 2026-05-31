import { NextResponse } from "next/server";
import { resetSim } from "@/app/_lib/sim-store";

export const runtime = "nodejs";

// Clear all artifacts from prior simulation runs so the demo re-runs cleanly.
export async function POST() {
  try {
    return NextResponse.json({ ok: true, cleared: resetSim() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reset failed." }, { status: 500 });
  }
}
