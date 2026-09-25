import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { getGigAttempt, listGigAttemptsByStatus } from "@/app/_lib/db/gigs-attempts";
import { syncGigAttempts } from "@/app/_lib/gigs/sync";
import type { GigAttempt } from "@/app/_lib/gigs/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/gigs/sync - the on-demand analogue of the clock's `gig_sync` job
// (instrumentation-node.ts -> late-bound-boot.ts). One pass of gigs/sync.ts
// over the workspace's in-flight attempts: pull each
// `dispatched | running` attempt's execution from the paired Personas app and
// land what finished (a deliverable -> `drafted`, a cut/parse failure ->
// `failed`, a start -> `running`). It WIDENS NOTHING - it never dispatches,
// reviews, approves or sends; a headless run that wants a fresh deliverable
// polls this instead of waiting the ~15-minute clock (docs/features/gigs).
//
//   200 { synced, attempts } - `synced` counts the attempts this pass moved off
//        `dispatched | running`; `attempts` are those moved rows (the same
//        GigAttempt projection GET /api/gigs/[id] returns), so a caller can read
//        a just-landed deliverable without a second GET. An unreachable Personas
//        moves nothing (each attempt is retried next pass): `{ synced: 0 }`.
//   500 GIG_STORE_FAILED
//
// Operator-gated + `pipeline:write`, and throttled per IP BEFORE the pass:
// every accepted call opens a socket to the local Personas app per in-flight
// attempt. 20/10min per IP, the dispatch/workspace door budget.

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-sync:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const ws = await currentWorkspace();
    // Snapshot the in-flight attempts BEFORE the pass: the summary carries counts,
    // not rows, so we read each snapshotted id back afterwards and report exactly
    // those whose status the pass advanced.
    const before = new Map(listGigAttemptsByStatus(ws, ["dispatched", "running"]).map((a) => [a.id, a.status]));
    await syncGigAttempts(ws);
    const attempts: GigAttempt[] = [];
    for (const [id, status] of before) {
      const now = getGigAttempt(ws, id);
      if (now && now.status !== status) attempts.push(now);
    }
    return NextResponse.json({ synced: attempts.length, attempts });
  } catch (error) {
    return safeJsonError(error, "api:gigs/sync", "GIG_STORE_FAILED");
  }
}
