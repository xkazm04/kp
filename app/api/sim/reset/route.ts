import { NextResponse } from "next/server";
import { resetSim } from "@/app/_lib/sim-store";
import { safeJsonError } from "@/app/_lib/api-response";
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
    // The purge runs a DELETE transaction across four tables: a thrown better-sqlite3
    // error carries the db path and constraint detail, and the sim console is the
    // reader — so a CODE it resolves in its own language, never the raw message. The
    // console now also KEYS OFF THE STATUS: it reports "reset" only on a 2xx.
    return safeJsonError(error, "api:sim/reset", "SIM_RESET_FAILED");
  }
}
