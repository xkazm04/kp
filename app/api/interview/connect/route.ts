import { NextRequest, NextResponse } from "next/server";
import {
  LIVE_INTERVIEW_RECENCY_MIN,
  createInterviewSession,
  getInterviewSessionByToken,
  isInterviewLinkExpired,
  isInterviewSessionLive,
  markInterviewStarted,
  revokeInterviewSession,
  setInterviewSessionProvider,
} from "@/app/_lib/db/interviews";
import { getEntryWorkspace, getPipelineEntry, recordAutomationEvent } from "@/app/_lib/db/pipeline";
import { isTerminalEntryStatus } from "@/app/_lib/pipeline-status";
import {
  coerceLanguage,
  coerceProviderId,
  connectWithFailover,
  defaultInterviewerInstructions,
  getVoiceAdapter,
  isSelfHostedProvider,
  missingVoiceEnv,
  voiceAvailability,
  type VoiceProviderId,
} from "@/app/_lib/voice";
import { QUICK_SCREEN_MIN } from "@/app/_lib/interview-duration.mjs";
import { buildCandidateSafeBrief, interviewAsrKeywords } from "@/app/_lib/interview-run";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { rateLimit } from "@/app/_lib/rate-limit";
import { isConnectConsentSatisfied } from "@/app/_lib/interview-consent";
import { isInterviewLabEnabled } from "@/app/_lib/interview-lab";

// EVERY refusal on this route now carries a code (/perfect 2026-09-02).
// /connect is a PUBLIC candidate surface reached from an emailed link rendered in
// the applicant's own language (`?lang=`), and its five lifecycle refusals were
// bare English sentences with no code - so the portal painted the server's English
// at a Czech applicant who had just been told, in Czech, to click that link. The
// canonical strings now live in REFUSAL_ERRORS beside every other refusal in the
// product, and the reader resolves `errors.<CODE>` in their own language.


// GET → which providers are configured (used by the UI to enable/disable the switcher).
export async function GET() {
  return NextResponse.json({ availability: voiceAvailability() });
}

// POST → mint short-lived browser credentials for the chosen provider and
// create/load the interview session. The browser connects directly afterward.
export async function POST(request: NextRequest) {
  try {
    // Validate at the trust boundary instead of casting request.json() to a
    // typed shape (idea-c7df6b55): token must be a plausibly-sized string,
    // language must look like a language tag, consent must be literally true.
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const token = typeof body.token === "string" && body.token.length <= 200 ? body.token : null;
    const language = coerceLanguage(body.language);

    // The browser picks the provider (the picker defaults to ElevenLabs and
    // disables any provider whose keys are missing). Honor that choice; fall
    // back to a token-bound session's stored provider when none is requested.
    const session0 = token ? getInterviewSessionByToken(token) : null;

    // Credential-minting gates (idea-6236b597). Both bad-token and tokenless
    // requests used to fall through to "create a test session and mint real
    // provider credentials" — free, unauthenticated minting of the most
    // expensive operation in the system (denial-of-wallet):
    //  - a PRESENTED token that doesn't resolve is a bad link, not an invitation
    //    to open a lab session — refuse it;
    //  - a truly tokenless request is the lab path, which is a dev harness:
    //    enabled outside production, opt-in via INTERVIEW_LAB_ENABLED=1 in it.
    if (token && !session0) {
      return jsonRefusal("INTERVIEW_LINK_NOT_FOUND", 404);
    }
    if (!token && !isInterviewLabEnabled()) {
      return jsonRefusal("INTERVIEW_LAB_DISABLED", 403);
    }

    // Single-use semantics, enforced server-side (idea-836e08d8): the portal
    // page only blocks the RENDER of a completed session — the API used to
    // force status back to in_progress and mint fresh provider credentials for
    // anyone holding the token, letting a candidate retake a finished screen.
    // The token is the only credential on the public link, so the server must
    // hold the line. A 'failed' session stays reconnectable on purpose: a
    // dropped call (provider hiccup, network blip) should be retryable.
    if (session0 && session0.status === "completed") {
      return jsonRefusal("INTERVIEW_ALREADY_COMPLETED", 409);
    }
    // W6-4 (VOX1) — the delivered link's lifecycle, enforced where the
    // credential is minted (the same hold-the-line stance as the completed
    // guard above):
    //  - revoked: the recruiter pulled the link (wrong candidate, reissue, …);
    //  - expired: an untaken `created` link past its TTL — auto-emailed links
    //    must not stay valid credentials forever;
    //  - terminal entry: W7 taught schedule-confirm to refuse rejected/declined
    //    candidates, but /connect never checked — a rejected candidate could
    //    still take (and be billed for) the AI screen. Revoke on sight. Hired
    //    keeps status 'active', so a hired candidate's pending screen survives.
    if (session0 && session0.status === "revoked") {
      return jsonRefusal("INTERVIEW_LINK_INACTIVE", 409);
    }
    if (session0 && isInterviewLinkExpired(session0)) {
      return jsonRefusal("INTERVIEW_LINK_EXPIRED", 409);
    }
    // ONE LIVE CALL PER LINK. The token IS the session, so two browser tabs on the
    // same interview link both reached this door: each minted its own provider
    // credentials (two paid sessions for one screen), each ran a real conversation,
    // and at hang-up the SECOND one to finish was answered `{ok:true,
    // alreadyCompleted:true}` — its transcript discarded while its candidate read a
    // saved confirmation. The same shape covers a link forwarded to a colleague and
    // a reload racing the call it is reloading.
    //
    // The window is LIVE_INTERVIEW_RECENCY_MIN (30 min from the last connect), the
    // SAME authority /create's reissue guard uses for "this candidate is on the call
    // right now" — one definition of live, so a link can never be simultaneously
    // too-live to reissue and free to re-dial. Past that grace the row is an
    // abandoned zombie and re-dialing is exactly the recovery a candidate needs.
    //
    // A genuinely dropped call does NOT wait the grace out: every teardown path
    // (hang-up, ICE drop, tab close via the unmount beacon) POSTs /complete, which
    // finalizes a non-substantive call as `failed` — reconnectable by design and no
    // longer `in_progress`, so it never reaches this guard.
    if (session0 && isInterviewSessionLive(session0)) {
      return jsonRefusal("INTERVIEW_ALREADY_LIVE", 409, { retryAfterMin: LIVE_INTERVIEW_RECENCY_MIN });
    }
    if (session0?.entryId) {
      // Tenant from the ENTRY, not a session — this is a public token route and the
      // candidate has no workspace cookie (the same rule /api/interview/complete and
      // the /status/[token] routes follow). Bare, the read resolved against the
      // DEFAULT team and returned null for every other one, so the terminal guard
      // below never fired: a rejected or withdrawn candidate could still start the
      // AI screen — and burn real ElevenLabs / OpenAI Realtime minutes against their
      // former employer's meter — on a link the recruiter believed was dead.
      const entry = getPipelineEntry(session0.entryId, getEntryWorkspace(session0.entryId));
      if (entry && isTerminalEntryStatus(entry.status)) {
        revokeInterviewSession(session0.id);
        return jsonRefusal("INTERVIEW_LINK_INACTIVE", 409);
      }
    }

    const requested = coerceProviderId(body.provider);
    const provider: VoiceProviderId | null = requested ?? session0?.provider ?? null;
    if (!provider) {
      return jsonRefusal("INTERVIEW_PROVIDER_INVALID", 400);
    }

    // Per-token connect throttle (backlog #15): a valid, non-terminal token could
    // otherwise mint provider sessions — the most expensive operation in the
    // system (ElevenLabs / OpenAI Realtime credits) — in a tight loop. Keyed by
    // TOKEN, not IP: the link is the credential, and an abuser rotating IPs must
    // not reset the budget. Sits AFTER the lifecycle guards (bad token /
    // completed / revoked / expired keep their 404/409 semantics) and BEFORE
    // markInterviewStarted + adapter.connect, so a throttled call does no work
    // (provider resolution above it is pure).
    // 6/10min = one start + five reconnects: a dropped call ('failed' stays
    // reconnectable by design) is retried manually, one click per attempt, so a
    // flaky-network session still fits; a credential-minting loop does not.
    // Tokenless lab sessions (dev-only, INTERVIEW_LAB_ENABLED-gated) pass through.
    // The raise applies to a session the FREE LOCAL provider will serve, and is
    // therefore decided AFTER provider resolution (scan-sweep 2026-08-22). It used
    // to read isSelfHostedVoice() — an ENV fact about whether a local service is
    // configured at all — evaluated BEFORE we knew who would serve. On an install
    // with a local ElevenLabs plus an OpenAI key, that let a token holder with an
    // OpenAI-provider session mint 120 PAID Realtime credentials per 10 min
    // instead of 6: a 20x denial-of-wallet on the premise's exact inverse.
    // For a genuinely self-hosted session the premise still holds — nothing
    // billable is minted — so the budget is raised rather than removed: a mint
    // loop still costs CPU on the box serving it, and an automated conversation
    // suite legitimately reconnects far more often than a human retrying a call.
    const connectLimit = isSelfHostedProvider(provider) ? 120 : 6;
    if (token && !rateLimit(`interview-connect:${token}`, { limit: connectLimit, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    const adapter = getVoiceAdapter(provider);
    if (!adapter.available()) {
      // Ask the adapter which of its keys are missing rather than re-encoding
      // provider-specific var names here — the adapter owns that knowledge.
      // `need` and `provider` ride ALONGSIDE the code rather than inside an English
      // sentence: the operator debugging a keyless install still gets the exact env
      // vars, while the candidate reads one localized line.
      return jsonRefusal("INTERVIEW_PROVIDER_UNCONFIGURED", 503, { provider, need: missingVoiceEnv(adapter) });
    }

    const instructions =
      session0?.instructions ||
      defaultInterviewerInstructions({ role: session0?.jobTitle });

    // An untokened lab session is the ungrounded quick screen, so it carries the
    // canonical quick-screen length (matches the "under 5 minutes" persona).
    const session =
      session0 ??
      createInterviewSession({
        provider,
        language,
        mode: "test",
        instructions,
        durationMin: QUICK_SCREEN_MIN,
      });

    // Consent is the legal basis for processing an AI-conducted, transcribed
    // candidate interview, so enforce it server-side (idea-98e6cf23) — not just
    // via the browser's disabled Start button. A candidate session without
    // explicit consent never mints credentials below nor flips to in_progress.
    if (!isConnectConsentSatisfied(session.mode, body.consent)) {
      return jsonRefusal("INTERVIEW_CONSENT_REQUIRED", 403);
    }

    // Atomic backstop for the check above: if a /complete landed between the
    // status read and here, the guarded UPDATE refuses to reopen the session —
    // and we must not mint credentials for it.
    if (!markInterviewStarted(session.id, body.consent === true)) {
      return jsonRefusal("INTERVIEW_ALREADY_COMPLETED", 409);
    }

    // THE INTERVIEWER BRIEF IS SERVER-SIDE ONLY (backlog #29 / TP-L2-VOICE-01).
    // `instructions` is the recruiter's PRIVATE brief — gap/provenance
    // annotations, "internal red flag — never say this aloud" notes — so it must
    // never ride the JSON back to the candidate's browser (a Network-tab away).
    // OpenAI receives it server-side in the client_secrets session config
    // (adapter.connect). ElevenLabs' signed-url flow has NO server-side session
    // config — its prompt overrides are client-sent by design — so a
    // candidate-mode ElevenLabs session gets a CANDIDATE-SAFE brief instead.
    // Entry-backed sessions get the GROUNDED candidate-safe brief
    // (buildCandidateSafeBrief: run-of-show topics + the questions asked aloud +
    // time-boxes + the opening-language hint, rebuilt through the ALLOW-LIST
    // sanitizers in voice/candidate-brief.ts so listenFor/redFlag/goal-annotations
    // structurally cannot survive). Sessions with no entry (or nothing grounded to
    // say) keep the generic prompt built only from the public job title + booked
    // length. Reused as the failover closure below so the EL/OAI brief paths never
    // fork between the primary attempt and a fallback.
    //
    // The grounded half is resolved BEFORE the failover call rather than inside the
    // closure: buildCandidateSafeBrief became async in wave 37 (its candidate-facing
    // topics now come from the locale-pinned catalog, so a German applicant's agenda
    // is German), and connectWithFailover's `resolveAgentPrompt` is synchronous by
    // contract — a failover must not await between the two connect attempts. The brief
    // is provider-independent (it is built from the ENTRY), so hoisting it changes
    // nothing about which prompt each provider gets; it only means a candidate-mode
    // OpenAI session pays for one brief build it will not use, which is why it is
    // gated on candidate mode + an entry rather than built unconditionally.
    let groundedCandidateBrief: string | null = null;
    if (session.mode === "candidate" && session.entryId) {
      try {
        groundedCandidateBrief = await buildCandidateSafeBrief(session.entryId);
      } catch {
        /* grounding is enrichment — fall back to the generic candidate-safe prompt */
      }
    }
    const resolveAgentPrompt = (served: VoiceProviderId): string | null => {
      if (served !== "elevenlabs" || session.mode !== "candidate") return null;
      return (
        groundedCandidateBrief ?? defaultInterviewerInstructions({ role: session.jobTitle, durationMin: session.durationMin })
      );
    };

    // Provider failover (Direction 3): the session is already in_progress
    // (markInterviewStarted above, a single CAS — no double-start on failover). If
    // the preferred provider's connect throws and the OTHER provider is available,
    // retry with it in THIS request, building its brief via its own path above.
    // Single-provider deployments (or only the preferred configured) re-throw the
    // original error unchanged, so today's INTERVIEW_CONNECT_FAILED is preserved.
    const {
      provider: served,
      connect,
      agentPrompt,
      failedOver,
    } = await connectWithFailover({
      preferred: provider,
      instructions,
      language: language ?? session.language,
      getAdapter: getVoiceAdapter,
      // A session that skipped /simulate's meterGate because the local provider is
      // free must never be rescued onto a PAID one — /complete would then price and
      // debit a call against a reservation that was never taken. connectWithFailover
      // re-throws the original error when the alternate is unavailable, so this
      // preserves today's INTERVIEW_CONNECT_FAILED semantics exactly.
      availability: isSelfHostedProvider(provider) ? { ...voiceAvailability(), openai: false } : voiceAvailability(),
      // Binds the minted credential to THIS session. Only a HASH of it is ever sent
      // to a provider (voice/openai.ts) — the token itself opens the whole interview
      // and never leaves this server.
      sessionToken: session.token,
      resolveAgentPrompt,
    });

    // Persist what ACTUALLY served so the completion ledger (voiceUsageRow reads
    // session.provider) and telemetry attribute to the real provider, not the
    // requested one — and leave a breadcrumb that a failover occurred.
    if (failedOver) {
      // …and the breadcrumb is now a COLUMN, not only a log line. `provider` is
      // overwritten in place with whoever served, so the provider the recruiter
      // actually chose used to survive nowhere a recruiter could reach: they saw a
      // call priced on the other vendor with no way to learn that theirs was down.
      // failover_from is written once (COALESCE in the store) and stays NULL on the
      // overwhelming majority of calls, where nothing fell back.
      setInterviewSessionProvider(session.id, served, provider);
      // An entry-backed session also leaves the fact on the candidate's timeline —
      // the same trail every other unattended action writes, so "why did this screen
      // run on ElevenLabs?" is answerable months later from the activity log rather
      // than from server logs that have long rotated. Best-effort: the audit marker
      // must never fail a call the candidate is waiting on.
      if (session.entryId) {
        try {
          recordAutomationEvent(
            session.entryId,
            "interview_failover",
            `${provider} → ${served} (preferred provider's connect failed)`,
            session.workspaceId,
            "auto:interview-connect"
          );
        } catch (eventErr) {
          // Telemetry, so never the request. Not silent either: this marker is the
          // only durable candidate-facing record that the chosen provider was down,
          // and an operator reconciling a surprising bill would act on it.
          console.error(
            `[interview:connect] failover event write failed for session ${session.id} (${provider} → ${served}):`,
            eventErr
          );
        }
      }
      console.warn(
        `[interview:connect] provider failover ${provider} → ${served} for session ${session.id} ` +
          `(preferred provider's connect failed; alternate served).`
      );
    }

    // Per-JOB ASR keyword bias for the served ElevenLabs session. The recognizer
    // corrupts technology names ("React" → "Rust", "PostgreSQL" → "později SQL")
    // and the scorecard then rates the corruption as a skill set, so the terms
    // this job actually talks about are pushed in front of the agent's
    // account-wide list. Client-sent (overrides.asr.keywords) because that is the
    // only place the ElevenLabs SDK accepts them — hence PUBLIC JOB FACTS ONLY,
    // enforced at the source in interviewAsrKeywords. OpenAI sessions get null:
    // their transcription is configured server-side and takes no keyword bias.
    const asrKeywords = served === "elevenlabs" ? interviewAsrKeywords(session.entryId) : null;

    // The session token rides back so /complete can demand it as the completion
    // capability (idea-5248c3e9). Candidate/sim callers already hold it (it is
    // how they got here); for a fresh lab session this is the creator receiving
    // the capability for the session they just made — no new exposure. `provider`
    // is the SERVED one — authoritative over the requested provider so the client
    // branches on what actually connected (it already keys on connect.provider).
    return NextResponse.json({
      sessionId: session.id,
      token: session.token,
      provider: served,
      agentPrompt,
      asrKeywords,
      connect,
    });
  } catch (error) {
    // Adapter errors embed upstream provider HTTP bodies (OpenAI client_secrets
    // / ElevenLabs signed-url responses) — internal detail that must not reach
    // the client (idea-ab117371). The not-configured 503 above stays specific:
    // its message is already client-safe by construction.
    return safeJsonError(error, "api:interview:connect", "INTERVIEW_CONNECT_FAILED");
  }
}
