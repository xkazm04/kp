import { NextRequest, NextResponse } from "next/server";
import { meterGate } from "@/app/_lib/billing/enforce";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { resolveEntryForSubmission } from "@/app/_lib/devcase-interview-entry";
import { mintAndInviteVoiceScreen } from "@/app/_lib/interview-invite";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { readEntityId } from "../entry-id";
import { GROUNDED_DEFAULT_MIN } from "@/app/_lib/interview-duration.mjs";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

// Per-IP spend door. One accepted call runs a model-backed run-of-show build AND
// emails the candidate, and the route is operator-gated only in the sense that
// open mode (KP_OPERATOR_PASSWORD unset) makes that gate a documented no-op for the
// ENTIRE API - so the limiter is the real bound, exactly as it is on the JD
// library's four spend doors. 20/10min: a Create link is followed by a human
// reading the drawer, so twenty in ten minutes is far above honest pace, while an
// automated loop over a board would otherwise spend LLM credit and mail a stranger
// once per request. The billing meter is a separate, per-workspace decision and
// deliberately not what this is.
const CREATE_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };
const MAX_CREATE_BODY_BYTES = 16 * 1024;

// POST → recruiter creates a candidate-mode voice screen for a pipeline entry.
// Builds grounded interviewer questions (Task 4) and returns a tokenized link
// to hand to the candidate. After the call, /complete runs the scorecard.
//
// The mint itself is NOT here: it lives in app/_lib/interview-invite.ts, which the
// pipeline stage hook (app/_lib/stage-hooks.ts) also calls when a candidate enters
// an AI interview step the hiring plan gates as `auto`. This handler owns only the
// transport concerns — the cheap pre-gate, body validation, the per-IP throttle,
// submission→entry resolution — and then maps the shared door's result onto the wire.
export async function POST(request: NextRequest) {
  try {
    // Billing hard gate — CHEAP PRE-CHECK: voice minutes are the one meter with real
    // per-unit cost. Reject an obviously-empty meter before doing the (possibly
    // LLM-backed) run-of-show build below. This uses the 20-min default because the
    // session's real booked length isn't known yet; the AUTHORITATIVE reservation —
    // gating on the WORST CASE /complete can debit (bookedMin*2) — runs inside
    // mintAndInviteVoiceScreen once `grounded` is built, before anything is revoked.
    // (Minutes debit at /complete; top-up packs reopen this.)
    // Org attribution (org-plan Phase 3): both gates read the caller's tenant.
    const workspace = await currentWorkspace();
    const quota = meterGate("interview_minutes", { minUnits: GROUNDED_DEFAULT_MIN, workspace });
    if (quota) return jsonRefusal("BILLING_QUOTA_EXCEEDED", 402, { meter: quota.meter, plan: quota.plan });
    // Validate at the trust boundary instead of casting request.json() to a
    // typed shape (idea-c7df6b55): entryId must be a plausibly-sized string and
    // language must look like a language tag — anything else is rejected or
    // dropped rather than passed into the DB layer.
    const body = await readJsonWithLimit<Record<string, unknown>>(request, MAX_CREATE_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_CREATE_BODY_BYTES });
    // ONE THREAD (gap 4) — a screen can be asked for by the entry it hangs off OR by
    // the SUBMISSION the reviewer is looking at. The eval surface holds a submission
    // id and never held an entry id, which is why the voice screen was reachable only
    // from the board. `entryId` still wins when both are sent: it is the more specific
    // request, and resolving a submission could legitimately answer a DIFFERENT entry
    // (the candidate applied to the opening directly and the promote backfilled that
    // row) — silently overriding an explicit entry would be the surprising half.
    let entryId = readEntityId(body.entryId) ?? "";
    let promotedForScreen = false;
    const submissionId = readEntityId(body.submissionId) ?? "";
    // Named NOTHING usable: refuse before the throttle below, so a malformed call
    // can never spend another caller's budget (the shape the JD spend doors follow).
    if (!entryId && !submissionId) {
      return jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400);
    }

    // Everything past this point either PROMOTES a submission onto the board, runs
    // the LLM-backed grounding, or emails the candidate. Throttle here, per IP.
    if (!rateLimit(`interview-create:${clientIpFrom(request.headers)}`, CREATE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    if (!entryId && submissionId) {
      // Resolves, or promotes through the SHARED promote door and then resolves — this
      // route never mints an identity of its own (devcase-interview-entry.ts).
      const resolved = resolveEntryForSubmission(submissionId, workspace);
      if (!resolved.ok) {
        // Unknown id and another team's id answer alike, on purpose: a distinct
        // refusal would confirm which submission ids exist on other tenants.
        return resolved.reason === "not_evaluated"
          ? jsonRefusal("INTERVIEW_SUBMISSION_NOT_EVALUATED", 400)
          : jsonRefusal("INTERVIEW_SUBMISSION_NOT_FOUND", 404);
      }
      entryId = resolved.entryId;
      promotedForScreen = resolved.promoted;
    }
    if (!entryId) {
      return jsonRefusal("INTERVIEW_ENTRY_REQUIRED", 400);
    }

    // The live-call guard, the grounded build, the authoritative reservation, the
    // revoke-then-create and the truthful invite dispatch all live behind this one
    // call — shared verbatim with the stage hook, so the two paths can never
    // disagree about reissue semantics or about what `delivery` claims.
    // `force: true` stays the explicit recruiter override of the live-call refusal.
    const minted = await mintAndInviteVoiceScreen({
      entryId,
      workspaceId: workspace,
      origin: new URL(request.url).origin,
      provider: body.provider,
      language: body.language,
      force: body.force === true,
    });
    if (!minted.ok) {
      // COMMS_SUPPRESSED: the send gate refuses this candidate (consent lapsed, or
      // erased) — the same 409 the single scheduling-invite door answers on the same
      // card, and nothing was built, reserved or minted.
      if (minted.refusal === "COMMS_SUPPRESSED") return jsonRefusal("COMMS_SUPPRESSED", 409);
      return minted.refusal === "INTERVIEW_CALL_IN_PROGRESS"
        ? jsonRefusal("INTERVIEW_CALL_IN_PROGRESS", 409)
        : jsonRefusal("BILLING_QUOTA_EXCEEDED", 402, { meter: minted.quota.meter, plan: minted.quota.plan });
    }

    return NextResponse.json({
      token: minted.session.token,
      // The RECRUITER's copy of the link — deliberately NOT `?lang=`-pinned (that
      // would rewrite their own NEXT_LOCALE cookie and flip the console's language);
      // only the EMAILED link carries the candidate's locale.
      url: `/interview/${minted.session.token}`,
      provider: minted.provider,
      configured: minted.configured,
      delivered: minted.delivered,
      // The TRUTHFUL claim (REC-10): the outbox row's real status — sent only on a
      // relayed 2xx, queued when the local outbox is the terminal target, failed on a
      // dead-letter/throw — so the drawer note can't say "invite sent to the
      // candidate" about a message nothing will deliver.
      delivery: minted.delivery,
      // null on a clean send; otherwise WHY, as a code the drawer renders in the
      // reader's language. "failed" alone left the recruiter guessing between "this
      // server has no voice keys, so no invite was even attempted" and "the relay
      // threw" — two different next actions, and only the second is worth a retry.
      deliveryError: minted.deliveryError,
      // W6-4 — how many prior open links this reissue invalidated (UI hint).
      revoked: minted.revoked,
      candidateLabel: minted.session.candidateLabel,
      jobTitle: minted.session.jobTitle,
      // ONE THREAD — the entry this screen hangs off, echoed so a caller who asked by
      // submissionId learns which board row it landed on, and `promoted` so it can say
      // that starting the screen also put the candidate there. Both are stated rather
      // than left for the recruiter to discover from the board.
      entryId,
      promoted: promotedForScreen,
    });
  } catch (error) {
    // buildGroundedInterview's not-found is a client-safe business rule, not an
    // internal leak — keep it specific. Everything else (SQLite, automation,
    // prep-generation errors) goes through the generic safe responder so raw
    // err.message never crosses the wire (idea-ab117371).
    if (error instanceof Error && error.message === "pipeline entry not found") {
      // Unknown entry and ANOTHER TEAM'S entry land here alike (buildGroundedInterview
      // resolves under the caller's workspace), which is the refusal the tenancy pass
      // wanted: one answer, no oracle.
      return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
    }
    return safeJsonError(error, "api:interview:create", "INTERVIEW_CREATE_FAILED");
  }
}
