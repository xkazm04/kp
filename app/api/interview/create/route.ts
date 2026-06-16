import { NextRequest, NextResponse } from "next/server";
import { meterGate } from "@/app/_lib/billing";
import {
  createInterviewSession,
  getPipelineEntry,
  isInterviewSessionLive,
  liveInterviewByEntry,
  revokeOpenInterviewSessions,
} from "@/app/_lib/db";
import { buildGroundedInterview } from "@/app/_lib/interview-run";
import { dispatchInterviewInvite } from "@/app/_lib/comms-dispatch";
import { safeJsonError } from "@/app/_lib/api-response";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { coerceLanguage, pickDefaultProvider, voiceAvailability, type VoiceProviderId } from "@/app/_lib/voice";

export const runtime = "nodejs";

// POST → recruiter creates a candidate-mode voice screen for a pipeline entry.
// Builds grounded interviewer questions (Task 4) and returns a tokenized link
// to hand to the candidate. After the call, /complete runs the scorecard.
export async function POST(request: NextRequest) {
  try {
    // Billing hard gate: voice minutes are the one meter with real per-unit
    // cost. No allowance → no new candidate links (existing live links keep
    // working; minutes are debited at /complete). Top-up packs reopen this.
    const quota = meterGate("interview_minutes");
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

    // W6-4 (VOX1) — reissue semantics: a fresh link kills the prior ones.
    // Re-clicking "Create link" used to mint a SECOND live session (and email a
    // second invite) while the first stayed valid forever — and the
    // latest-by-created_at read meant an old link completed after a reissue
    // wasn't even the surfaced session. Revoking first makes exactly one link
    // live per entry.
    const revoked = revokeOpenInterviewSessions(entryId);

    const grounded = await buildGroundedInterview(entryId);
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
    let delivered = false;
    if (avail[provider]) {
      try {
        const link = `${publicBaseUrl(new URL(request.url).origin)}/interview/${session.token}`;
        // SIM3 — invite in the applicant's language; the session carries no
        // locale, so read it off the entry (one lookup, only on a delivered invite).
        const inviteLocale = getPipelineEntry(entryId)?.locale ?? null;
        await dispatchInterviewInvite(
          { id: entryId, candidateLabel: session.candidateLabel, jobTitle: session.jobTitle, locale: inviteLocale },
          link,
          { durationMin: grounded.durationMin }
        );
        delivered = true;
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
