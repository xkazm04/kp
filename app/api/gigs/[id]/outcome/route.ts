import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { recordGigOutcome } from "@/app/_lib/gigs/outcome";
import { GIG_OUTCOME_VERDICTS, isGigOutcomeVerdict } from "@/app/_lib/gigs/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/gigs/[id]/outcome { verdict, amount?, currency?, feedbackText?, attemptId? }
// The external judge's verdict on sent work, as the operator read it (source `manual`).
// gigs/outcome.ts does the rest - the same path the pollers take:
//   - the verdict is APPENDED (gig_outcomes never updates; a correction is a newer row);
//   - the gig moves sent -> accepted | rejected (duplicate is a rejection) | expired
//     (no_response: the operator stopped waiting; `expired` claims no verdict);
//   - the gig's source folds it into its invalid streak - `sourcePaused: true` in the
//     answer when THIS verdict paused the source;
//   - one lesson per recipe the specialist adopted is queued for the registry lander.
// `attemptId` defaults to the gig's latest sent attempt. A verdict on a gig already
// resolved is a correction: appended, lessons queued, no status move, no streak change.
//
//   201 { outcome, gig, statusMoved, correction, sourcePaused, lessons }
//   404 GIG_NOT_FOUND / GIG_ATTEMPT_NOT_FOUND · 409 GIG_OUTCOME_NOT_SENT · 400 GIG_INPUT_INVALID

const FEEDBACK_MAX = 8000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-outcome:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      verdict?: unknown;
      amount?: unknown;
      currency?: unknown;
      feedbackText?: unknown;
      attemptId?: unknown;
    };
    if (!isGigOutcomeVerdict(body.verdict)) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "verdict", allowed: GIG_OUTCOME_VERDICTS });
    let amount: number | null = null;
    if (body.amount !== undefined && body.amount !== null) {
      if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount < 0) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "amount" });
      amount = body.amount;
    }
    if (body.currency !== undefined && body.currency !== null && typeof body.currency !== "string") return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "currency" });
    if (body.feedbackText !== undefined && body.feedbackText !== null && typeof body.feedbackText !== "string") return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "feedbackText" });
    if (body.attemptId !== undefined && body.attemptId !== null && typeof body.attemptId !== "string") return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "attemptId" });

    const ws = await currentWorkspace();
    const res = recordGigOutcome(ws, {
      gigId: id,
      attemptId: typeof body.attemptId === "string" && body.attemptId ? body.attemptId : null,
      verdict: body.verdict,
      amount,
      currency: typeof body.currency === "string" ? body.currency : null,
      feedbackText: typeof body.feedbackText === "string" ? body.feedbackText.slice(0, FEEDBACK_MAX) : null,
      source: "manual",
    });
    if (!res.ok) return jsonRefusal(res.code, res.code === "GIG_OUTCOME_NOT_SENT" ? 409 : 404);
    return NextResponse.json(
      {
        outcome: res.outcome,
        gig: res.gig,
        statusMoved: res.statusMoved,
        correction: res.correction,
        sourcePaused: res.sourcePaused,
        lessons: res.lessons,
      },
      { status: 201 }
    );
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]/outcome", "GIG_STORE_FAILED");
  }
}
