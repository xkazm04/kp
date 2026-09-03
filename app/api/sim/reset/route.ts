import { NextResponse, type NextRequest } from "next/server";
import { beginSimRun, endSimRun, resetSim } from "@/app/_lib/sim-store";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


// Clear all artifacts from prior simulation runs so the demo re-runs cleanly, and
// hold the workspace's RUN LOCK while a walk is live.
//
// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #2): purge the CALLER's tenant.
// Previously this called resetSim() with no argument, always hitting the DEFAULT
// workspace — so a public demo (DEMO_WORKSPACE session) never cleaned its own (SIM)
// residue (it accumulated across runs), and the "cleared" count was counted from the
// wrong workspace. Threading currentWorkspace() scopes the purge to who's asking.
//
// The lock (/perfect wave 22): every anonymous demo visitor and every operator tab
// shares ONE tenant, and a run STARTS by deleting every SIM row in it — so a second
// start wiped the first run's job mid-walk and the victim died on an unrelated
// sentence. Two shapes, one door:
//
//   POST { hold: true }   a run is starting: claim the lock, purge, KEEP it.
//                         Refused with SIM_RUN_ACTIVE (409) when another run holds
//                         it, so the second visitor is told rather than served a
//                         wipe of someone else's tour.
//   POST                  a manual reset: claim, purge, release immediately. Still
//                         refused while a run is live — that is the whole point.
//   DELETE                the run ended (done / stopped / failed): release.
//
// The lock is in-process and TTL-bounded (SIM_RUN_TTL_MS): a courtesy against the
// racing-tabs case that actually happens on one self-hosted server, never an
// authorization boundary. The DELETEs stay workspace-scoped regardless.
export async function POST(request: NextRequest) {
  try {
    const ws = await currentWorkspace();
    const body = (await request.json().catch(() => null)) as { hold?: boolean } | null;
    const claim = beginSimRun(ws);
    if (!claim.ok) {
      return jsonRefusal("SIM_RUN_ACTIVE", 409, { retryAfterSeconds: Math.ceil(claim.retryAfterMs / 1000) });
    }
    try {
      const cleared = resetSim(ws);
      return NextResponse.json({ ok: true, cleared });
    } finally {
      // A manual reset holds the lock only for the length of its own purge; a run
      // start keeps it until the walk's DELETE (or the lease expires).
      if (!body?.hold) endSimRun(ws);
    }
  } catch (error) {
    // The purge runs a DELETE transaction across thirteen tables: a thrown
    // better-sqlite3 error carries the db path and constraint detail, and the sim
    // console is the reader — so a CODE it resolves in its own language, never the
    // raw message. The console now also KEYS OFF THE STATUS: it reports "reset" only
    // on a 2xx. The lock is NOT released here on purpose when a run was holding it:
    // a failed purge mid-run must not invite a second start onto dirty data; the TTL
    // is what clears it.
    return safeJsonError(error, "api:sim/reset", "SIM_RESET_FAILED");
  }
}

// The run ended. Idempotent, and deliberately unconditional: a walk that failed, was
// stopped or finished all release the same way, and releasing a lease that already
// expired is a no-op.
export async function DELETE() {
  const ws = await currentWorkspace();
  endSimRun(ws);
  return NextResponse.json({ ok: true, released: true });
}
