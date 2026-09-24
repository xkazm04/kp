import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { listGigAttemptsForGig } from "@/app/_lib/db/gigs-attempts";
import { dispatchGigAttempt } from "@/app/_lib/gigs/dispatch";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/gigs/[id]/dispatch { revisionNote? } - send the gig to its specialist's
// Personas persona as a new attempt (gigs/dispatch.ts: claim by CAS, create the attempt,
// POST outside any transaction, stamp the execution id).
//
// `revisionNote` defaults to the note of the gig's LATEST attempt when that attempt ended
// `revision_requested` or `failed` carrying one - a revise whose re-dispatch was refused
// (no specialist yet) or failed (Personas down) is retried here without the operator
// retyping the note.
//
//   200 { gig, attempt, executionId }
//   404 GIG_NOT_FOUND · 409 GIG_SUSPECT · 409 GIG_NOT_DISPATCHABLE (`detail` = status or
//   the lost CAS) · 409 GIG_SPECIALIST_NOT_READY (`detail`) · 502 GIG_DISPATCH_FAILED
//   ({ reason, attempt, gig } - the reason is the transport's code, never an error text)
//
// Throttled per IP BEFORE the body is read: every accepted call is a metered Personas run.

const REVISION_NOTE_MAX = 4000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-dispatch:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { revisionNote?: unknown };
    if (body.revisionNote !== undefined && body.revisionNote !== null && typeof body.revisionNote !== "string") {
      return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "revisionNote" });
    }
    const ws = await currentWorkspace();
    let revisionNote = typeof body.revisionNote === "string" && body.revisionNote.trim() ? body.revisionNote.trim().slice(0, REVISION_NOTE_MAX) : null;
    if (revisionNote === null) {
      const attempts = listGigAttemptsForGig(ws, id);
      const latest = attempts[attempts.length - 1];
      // A refused re-dispatch leaves the revised attempt last; a FAILED one leaves the new,
      // failed attempt last - it carries the same note.
      if ((latest?.status === "revision_requested" || latest?.status === "failed") && latest.revisionNote) {
        revisionNote = latest.revisionNote;
      }
    }
    const res = await dispatchGigAttempt(ws, id, { revisionNote });
    if (res.ok) return NextResponse.json({ gig: res.gig, attempt: res.attempt, executionId: res.executionId });
    if (res.code === "GIG_DISPATCH_FAILED") {
      return jsonRefusal("GIG_DISPATCH_FAILED", 502, { reason: res.reason, attempt: res.attempt, gig: res.gig });
    }
    if (res.code === "GIG_NOT_FOUND") return jsonRefusal("GIG_NOT_FOUND", 404);
    return jsonRefusal(res.code, 409, res.detail ? { detail: res.detail } : undefined);
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]/dispatch", "GIG_STORE_FAILED");
  }
}
