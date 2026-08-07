import { NextResponse } from "next/server";
import { resetSim } from "@/app/_lib/sim-store";
import { jsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


// Clear all artifacts from prior simulation runs so the demo re-runs cleanly.
// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #2): purge the CALLER's tenant.
// Previously this called resetSim() with no argument, always hitting the DEFAULT
// workspace — so a public demo (DEMO_WORKSPACE session) never cleaned its own (SIM)
// residue (it accumulated across runs), and the "cleared" count was counted from the
// wrong workspace. Threading currentWorkspace() scopes the purge to who's asking.
export async function POST() {
  try {
    const ws = await currentWorkspace();
    return NextResponse.json({ ok: true, cleared: resetSim(ws) });
  } catch (error) {
    return jsonError(error, "Reset failed.");
  }
}
