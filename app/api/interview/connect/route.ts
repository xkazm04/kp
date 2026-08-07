import { NextRequest, NextResponse } from "next/server";
import {
  createInterviewSession,
  getInterviewSessionByToken,
  getPipelineEntry,
  isInterviewLinkExpired,
  markInterviewStarted,
  revokeInterviewSession,
} from "@/app/_lib/db";
import { isTerminalEntryStatus } from "@/app/_lib/pipeline-status";
import {
  coerceLanguage,
  coerceProviderId,
  defaultInterviewerInstructions,
  getVoiceAdapter,
  missingVoiceEnv,
  voiceAvailability,
  type VoiceProviderId,
} from "@/app/_lib/voice";
import { QUICK_SCREEN_MIN } from "@/app/_lib/interview-duration.mjs";
import { safeJsonError } from "@/app/_lib/api-response";
import { rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { CONSENT_REQUIRED_ERROR, isConnectConsentSatisfied } from "@/app/_lib/interview-consent";
import { INTERVIEW_LAB_DISABLED_ERROR, isInterviewLabEnabled } from "@/app/_lib/interview-lab";


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
      return NextResponse.json({ error: "interview link not found" }, { status: 404 });
    }
    if (!token && !isInterviewLabEnabled()) {
      return NextResponse.json({ error: INTERVIEW_LAB_DISABLED_ERROR }, { status: 403 });
    }

    // Single-use semantics, enforced server-side (idea-836e08d8): the portal
    // page only blocks the RENDER of a completed session — the API used to
    // force status back to in_progress and mint fresh provider credentials for
    // anyone holding the token, letting a candidate retake a finished screen.
    // The token is the only credential on the public link, so the server must
    // hold the line. A 'failed' session stays reconnectable on purpose: a
    // dropped call (provider hiccup, network blip) should be retryable.
    if (session0 && session0.status === "completed") {
      return NextResponse.json({ error: "This interview has already been completed." }, { status: 409 });
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
      return NextResponse.json({ error: "This interview link is no longer active." }, { status: 409 });
    }
    if (session0 && isInterviewLinkExpired(session0)) {
      return NextResponse.json(
        { error: "This interview link has expired. Please ask the recruiter for a fresh one." },
        { status: 409 }
      );
    }
    if (session0?.entryId) {
      const entry = getPipelineEntry(session0.entryId);
      if (entry && isTerminalEntryStatus(entry.status)) {
        revokeInterviewSession(session0.id);
        return NextResponse.json({ error: "This interview link is no longer active." }, { status: 409 });
      }
    }

    // Per-token connect throttle (backlog #15): a valid, non-terminal token could
    // otherwise mint provider sessions — the most expensive operation in the
    // system (ElevenLabs / OpenAI Realtime credits) — in a tight loop. Keyed by
    // TOKEN, not IP: the link is the credential, and an abuser rotating IPs must
    // not reset the budget. Sits AFTER the lifecycle guards (bad token /
    // completed / revoked / expired keep their 404/409 semantics) and BEFORE
    // markInterviewStarted + adapter.connect, so a throttled call does no work.
    // 6/10min = one start + five reconnects: a dropped call ('failed' stays
    // reconnectable by design) is retried manually, one click per attempt, so a
    // flaky-network session still fits; a credential-minting loop does not.
    // Tokenless lab sessions (dev-only, INTERVIEW_LAB_ENABLED-gated) pass through.
    if (token && !rateLimit(`interview-connect:${token}`, { limit: 6, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }

    const requested = coerceProviderId(body.provider);
    const provider: VoiceProviderId | null = requested ?? session0?.provider ?? null;
    if (!provider) {
      return NextResponse.json({ error: "provider must be 'openai' or 'elevenlabs'" }, { status: 400 });
    }

    const adapter = getVoiceAdapter(provider);
    if (!adapter.available()) {
      // Ask the adapter which of its keys are missing rather than re-encoding
      // provider-specific var names here — the adapter owns that knowledge.
      const need = missingVoiceEnv(adapter).join(" and ");
      return NextResponse.json(
        { error: `${provider} is not configured — set ${need} in .env.local and restart.`, provider },
        { status: 503 }
      );
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
      return NextResponse.json({ error: CONSENT_REQUIRED_ERROR }, { status: 403 });
    }

    // Atomic backstop for the check above: if a /complete landed between the
    // status read and here, the guarded UPDATE refuses to reopen the session —
    // and we must not mint credentials for it.
    if (!markInterviewStarted(session.id, body.consent === true)) {
      return NextResponse.json({ error: "This interview has already been completed." }, { status: 409 });
    }

    const connect = await adapter.connect({ instructions, language: language ?? session.language });
    // THE INTERVIEWER BRIEF IS SERVER-SIDE ONLY (backlog #29 / TP-L2-VOICE-01).
    // `instructions` is the recruiter's PRIVATE brief — gap/provenance
    // annotations, "internal red flag — never say this aloud" notes — so it must
    // never ride the JSON back to the candidate's browser (a Network-tab away).
    // OpenAI already receives it server-side in the client_secrets session
    // config (adapter.connect above). ElevenLabs' signed-url flow has NO
    // server-side session config — its prompt overrides are client-sent by
    // design — so a candidate-mode ElevenLabs session gets a CANDIDATE-SAFE
    // agent prompt instead: the generic screening script built only from the
    // public job title + booked length, never the private brief. The stored
    // run-of-show can itself carry assessment annotations, so no per-candidate
    // material is projected into this prompt at all.
    const agentPrompt =
      connect.provider === "elevenlabs" && session.mode === "candidate"
        ? defaultInterviewerInstructions({ role: session.jobTitle, durationMin: session.durationMin })
        : null;
    // The session token rides back so /complete can demand it as the completion
    // capability (idea-5248c3e9). Candidate/sim callers already hold it (it is
    // how they got here); for a fresh lab session this is the creator receiving
    // the capability for the session they just made — no new exposure.
    return NextResponse.json({
      sessionId: session.id,
      token: session.token,
      provider,
      agentPrompt,
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
