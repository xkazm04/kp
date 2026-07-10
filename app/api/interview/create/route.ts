import { NextRequest, NextResponse } from "next/server";
import { meterGate, maxBillableInterviewMin } from "@/app/_lib/billing/enforce";
import {
  createInterviewSession,
  getPipelineEntry,
  isInterviewSessionLive,
  liveInterviewByEntry,
  revokeOpenInterviewSessions,
} from "@/app/_lib/db";
import { buildGroundedInterview } from "@/app/_lib/interview-run";
import { dispatchInterviewInvite } from "@/app/_lib/comms-dispatch";
import { deliveryClaim, isRelayConfigured, type DeliveryClaim } from "@/app/_lib/comms-truth";
import { safeJsonError } from "@/app/_lib/api-response";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { coerceLanguage, pickDefaultProvider, voiceAvailability, type VoiceProviderId } from "@/app/_lib/voice";
import { GROUNDED_DEFAULT_MIN } from "@/app/_lib/interview-duration.mjs";


// POST → recruiter creates a candidate-mode voice screen for a pipeline entry.
// Builds grounded interviewer questions (Task 4) and returns a tokenized link
// to hand to the candidate. After the call, /complete runs the scorecard.
export async function POST(request: NextRequest) {
  try {
    // Billing hard gate — CHEAP PRE-CHECK: voice minutes are the one meter with real
    // per-unit cost. Reject an obviously-empty meter before doing the (possibly
    // LLM-backed) run-of-show build below. This uses the 20-min default because the
    // session's real booked length isn't known yet; the AUTHORITATIVE reservation —
    // gating on the WORST CASE /complete can debit (bookedMin*2) — runs once `grounded`
    // is built, before we revoke any existing link. (Minutes debit at /complete; top-up
    // packs reopen this.)
    const quota = meterGate("interview_minutes", { minUnits: GROUNDED_DEFAULT_MIN });
    if (quota) return NextResponse.json(quota, { status: 402 });
    // Validate at the trust boundary instead of casting request.json() to a
    // typed shape (idea-c7df6b55): entryId must be a plausibly-sized string and
    // language must look like a language tag — anything else is rejected or
    // dropped rather than passed into the DB layer.
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const entryId = typeof body.entryId === "string" ? body.entryId.trim() : "";
    if (!entryId || entryId.length > 120) {
      return NextResponse.json({ error: "entryId is required" }, { status: 400 });
    }

    const avail = voiceAvailability();
    const provider: VoiceProviderId = pickDefaultProvider(body.provider, avail);

    // A reissue must not torpedo a LIVE call (voice-interview-runtime #2): the
    // revoke-first semantics below kill in_progress sessions too, so one click
    // on a mid-call entry revoked the candidate's session and emailed them a
    // second invite while they were still talking. Hold the line like
    // /connect's guards: refuse while the entry has a recently-touched
    // in_progress session. Stale zombies (a connect that never completed,
    // older than the recency window) fall through and may be reissued;
    // `force: true` is the explicit recruiter override.
    if (body.force !== true) {
      const live = liveInterviewByEntry(entryId);
      if (live && isInterviewSessionLive(live)) {
        return NextResponse.json(
          { error: "An interview is in progress for this candidate — wait for the call to finish before issuing a new link." },
          { status: 409 }
        );
      }
    }

    // Build the run-of-show FIRST so its booked duration is known — and BEFORE the
    // revoke below, so a quota refusal or a build failure can never kill the
    // candidate's existing live link (revoke now happens only once we're committed).
    const grounded = await buildGroundedInterview(entryId);

    // AUTHORITATIVE billing reservation: refuse unless the meter can cover the WORST
    // CASE /complete can debit for THIS session — maxBillableInterviewMin(bookedMin) =
    // bookedMin*2, the exact ceiling the debit clamps to. The cheap pre-gate above only
    // reserved the 20-min default, so a session booked for 30 min (up to 60 billed) could
    // pass with 20 minutes left and drive the priciest meter negative. Reserving the true
    // ceiling closes that under-reservation.
    const reserve = meterGate("interview_minutes", { minUnits: maxBillableInterviewMin(grounded.durationMin) });
    if (reserve) return NextResponse.json(reserve, { status: 402 });

    // W6-4 (VOX1) — reissue semantics: a fresh link kills the prior ones.
    // Re-clicking "Create link" used to mint a SECOND live session (and email a
    // second invite) while the first stayed valid forever — and the
    // latest-by-created_at read meant an old link completed after a reissue
    // wasn't even the surfaced session. Revoking first makes exactly one link
    // live per entry.
    const revoked = revokeOpenInterviewSessions(entryId);

    const session = createInterviewSession({
      provider,
      mode: "candidate",
      entryId,
      candidateLabel: grounded.candidateLabel,
      jobId: grounded.jobId,
      jobTitle: grounded.jobTitle,
      instructions: grounded.instructions,
      runOfShow: grounded.runOfShow,
      durationMin: grounded.durationMin,
      language: coerceLanguage(body.language),
    });

    // Deliver the link TO the candidate (the screen is candidate-mode — they take
    // the call). Gated on the provider being configured: an unconfigured key means
    // the call can't connect, so don't invite someone to a dead link. Goes through
    // the durable Outbox channel (real relay only when configured), and is
    // best-effort — a comms failure must not fail session creation, since the
    // recruiter can still copy the link returned below as a manual fallback.
    // `delivery` is the TRUTHFUL claim (REC-10): the outbox row's real status —
    // sent only on a relayed 2xx, queued when the local outbox is the terminal
    // target, failed on a dead-letter/throw — so the drawer note can't say
    // "invite sent to the candidate" about a message nothing will deliver.
    let delivered = false;
    let delivery: DeliveryClaim = "failed";
    if (avail[provider]) {
      try {
        const link = `${publicBaseUrl(new URL(request.url).origin)}/interview/${session.token}`;
        // SIM3 — invite in the applicant's language; the session carries no
        // locale, so read it off the entry (one lookup, only on a delivered invite).
        const inviteLocale = getPipelineEntry(entryId)?.locale ?? null;
        const status = await dispatchInterviewInvite(
          { id: entryId, candidateLabel: session.candidateLabel, jobTitle: session.jobTitle, locale: inviteLocale },
          link,
          { durationMin: grounded.durationMin }
        );
        delivery = deliveryClaim(isRelayConfigured(), status);
        delivered = delivery !== "failed";
      } catch (commErr) {
        console.error(
          `[interview:create] session ${session.token} created but invite delivery failed: ${commErr instanceof Error ? commErr.message : commErr}`
        );
      }
    }

    return NextResponse.json({
      token: session.token,
      url: `/interview/${session.token}`,
      provider,
      configured: avail[provider],
      delivered,
      delivery,
      // W6-4 — how many prior open links this reissue invalidated (UI hint).
      revoked,
      candidateLabel: session.candidateLabel,
      jobTitle: session.jobTitle,
    });
  } catch (error) {
    // buildGroundedInterview's not-found is a client-safe business rule, not an
    // internal leak — keep it specific. Everything else (SQLite, automation,
    // prep-generation errors) goes through the generic safe responder so raw
    // err.message never crosses the wire (idea-ab117371).
    if (error instanceof Error && error.message === "pipeline entry not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return safeJsonError(error, "api:interview:create", "INTERVIEW_CREATE_FAILED");
  }
}
