import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { getGigAttempt } from "@/app/_lib/db/gigs-attempts";
import { applyGigReview } from "@/app/_lib/gigs/review";
import { GIG_REVIEW_ACTIONS, isGigReviewAction } from "@/app/_lib/gigs/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// /api/gigs/attempts/[id] - one specialist run, and the operator's review of it.
// GET  -> { attempt }
// POST { action: "approve" | "revise" | "discard" | "mark_sent", review?: { checklist,
//        note, reviewMs } } -> gigs/review.ts, which holds the table of what each action
//        does to the attempt AND the gig. `mark_sent` is refused 422
//        GIG_DISCLOSURE_REQUIRED unless the review ticks the disclosure item; `revise`
//        needs `review.note` (400 GIG_REVISION_NOTE_REQUIRED) and re-dispatches a NEW
//        attempt carrying it - a refused or failed re-dispatch answers with the dispatch
//        code, the revision request itself standing (`revisionRecorded: true`).
//
// Throttled per IP BEFORE the body is read: `revise` spends a Personas run.

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const attempt = getGigAttempt(await currentWorkspace(), id);
    if (!attempt) return jsonRefusal("GIG_ATTEMPT_NOT_FOUND", 404);
    return NextResponse.json({ attempt });
  } catch (error) {
    return safeJsonError(error, "api:gigs/attempts/[id]", "GIG_STORE_FAILED");
  }
}

const REFUSAL_STATUS = {
  GIG_ATTEMPT_NOT_FOUND: 404,
  GIG_ACTION_NOT_ALLOWED: 409,
  GIG_STATE_CHANGED: 409,
  GIG_DISCLOSURE_REQUIRED: 422,
  GIG_REVISION_NOTE_REQUIRED: 400,
} as const;

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-review:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; review?: unknown };
    if (!isGigReviewAction(body.action)) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "action", allowed: GIG_REVIEW_ACTIONS });
    if (body.review !== undefined && body.review !== null && (typeof body.review !== "object" || Array.isArray(body.review))) {
      return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "review" });
    }
    const ws = await currentWorkspace();
    const res = await applyGigReview(ws, id, body.action, body.review ?? null);
    if (!res.ok) return jsonRefusal(res.code, REFUSAL_STATUS[res.code], res.detail ? { detail: res.detail } : undefined);
    const d = res.dispatch;
    if (d && !d.ok) {
      const extra = { revisionRecorded: true, attempt: res.attempt, gig: res.gig };
      if (d.code === "GIG_DISPATCH_FAILED") return jsonRefusal("GIG_DISPATCH_FAILED", 502, { ...extra, reason: d.reason, newAttempt: d.attempt });
      if (d.code === "GIG_NOT_FOUND") return jsonRefusal("GIG_NOT_FOUND", 404, extra);
      return jsonRefusal(d.code, 409, d.detail ? { ...extra, detail: d.detail } : extra);
    }
    return NextResponse.json({
      attempt: res.attempt,
      gig: d && d.ok ? d.gig : res.gig,
      ...(d && d.ok ? { newAttempt: d.attempt, executionId: d.executionId } : {}),
    });
  } catch (error) {
    return safeJsonError(error, "api:gigs/attempts/[id]", "GIG_STORE_FAILED");
  }
}
