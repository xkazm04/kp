import { NextResponse, type NextRequest } from "next/server";
import { beginSimRun, endSimRun, resetSim } from "@/app/_lib/sim-store";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { SIM_RUN_TOKEN_HEADER } from "@/app/features/shell/simulation/simRunLease";

/** The lease token a claimant presents to release its own run. A header, not the URL:
 *  it keeps the token out of access logs and lets DELETE stay bodyless. */
function leaseToken(request: NextRequest): string | null {
  return request.headers.get(SIM_RUN_TOKEN_HEADER);
}

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
//   POST { hold: true }   a run is starting: claim the lock, purge, KEEP it, and
//                         answer the lease TOKEN. Refused with SIM_RUN_ACTIVE (409)
//                         when another run holds it, so the second visitor is told
//                         rather than served a wipe of someone else's tour.
//   POST                  a manual reset: claim, purge, release immediately. Still
//                         refused while a run is live — that is the whole point.
//   DELETE                the run ended (done / stopped / failed): release, but only
//                         for the claimant that presents the token.
//
// /perfect wave 44 — the lease has an OWNER. Until then the release was
// unconditional on both sides: a second tab refused with SIM_RUN_ACTIVE still ran
// its own `finally` DELETE, this route freed the first tab's lease, and the next
// press purged a live run. SIM_RUN_NOT_OWNER (409) is the answer now.
//
// 409 rather than 403 on purpose: this lock is a courtesy against racing tabs on one
// self-hosted server, NEVER an authorization boundary (nothing downstream trusts it,
// and the DELETEs stay workspace-scoped either way). The caller is not forbidden, it
// is out of date about the tenant's state — the same conflict SIM_RUN_ACTIVE reports,
// from the other side, and it carries the same `retryAfterSeconds`.
//
// The lock is in-process and TTL-bounded (SIM_RUN_TTL_MS).
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
      // The token rides back ONLY on a held claim: a manual reset has already
      // released by the time this returns, so handing it one would be a lease that
      // does not exist.
      return NextResponse.json({ ok: true, cleared, ...(body?.hold ? { token: claim.token } : {}) });
    } finally {
      // A manual reset holds the lock only for the length of its own purge; a run
      // start keeps it until the walk's DELETE (or the lease expires).
      if (!body?.hold) endSimRun(ws, claim.token);
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

// The run ended. Idempotent for the OWNER: a walk that failed, was stopped or
// finished all release the same way, and releasing a lease that already expired (or
// was never taken) is a no-op success.
//
// What it is no longer is unconditional. A caller with no token, or another run's
// token, cannot free a LIVE lease — that request comes from a tab whose own start
// was refused, and honouring it is the wave-22 regression restored.
export async function DELETE(request: NextRequest) {
  const ws = await currentWorkspace();
  const released = endSimRun(ws, leaseToken(request));
  if (!released.released) {
    return jsonRefusal("SIM_RUN_NOT_OWNER", 409, { retryAfterSeconds: Math.ceil(released.retryAfterMs / 1000) });
  }
  return NextResponse.json({ ok: true, released: true });
}
