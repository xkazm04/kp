import { NextRequest, NextResponse } from "next/server";
import {
  LIVE_INTERVIEW_RECENCY_MIN,
  createInterviewSession,
  getInterviewSessionById,
  getInterviewSessionByToken,
  isInterviewLinkExpired,
  isInterviewSessionLive,
  isInterviewSessionStillLive,
  markInterviewRecordingConsent,
  markInterviewStarted,
  revokeInterviewSession,
  setInterviewAgenda,
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
  providerTraits,
  voiceAvailability,
  type VoiceProviderId,
} from "@/app/_lib/voice";
import { QUICK_SCREEN_MIN } from "@/app/_lib/interview-duration.mjs";
import {
  buildCandidateSafeBrief,
  buildGroundedInterview,
  buildRehearsalBriefs,
  interviewAsrKeywords,
  jobAsrKeywords,
} from "@/app/_lib/interview-run";
import {
  buildInterviewKit,
  buildKitOnlyInterviewKit,
  reconcileKitWithStoredAgenda,
  toCandidateAgendaView,
  type InterviewKit,
} from "@/app/_lib/interview-agenda";
import { isCandidateInterview, isKitRehearsal } from "@/app/_lib/interview-rehearsal";
import { buildResumeContext } from "@/app/_lib/voice/resume";
import { resumeAddendum } from "@/app/_lib/voice/director-brief";
import { DIRECTOR_TOOL_DEFS, type ResumeContext } from "@/app/_lib/voice/director-types";
import { isInterviewRecordingOffered } from "@/app/_lib/interview-recording";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { rateLimit } from "@/app/_lib/rate-limit";
import { isConnectConsentSatisfied } from "@/app/_lib/interview-consent";
import { isInterviewLabEnabled } from "@/app/_lib/interview-lab";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

// EVERY refusal on this route now carries a code (/perfect 2026-09-02).
// /connect is a PUBLIC candidate surface reached from an emailed link rendered in
// the applicant's own language (`?lang=`), and its five lifecycle refusals were
// bare English sentences with no code - so the portal painted the server's English
// at a Czech applicant who had just been told, in Czech, to click that link. The
// canonical strings now live in REFUSAL_ERRORS beside every other refusal in the
// product, and the reader resolves `errors.<CODE>` in their own language.


/** The session left `in_progress` while this request was working on it (the
 *  transition table, interview-session-status.ts: only a connect moves a row INTO
 *  live, so leaving it means a recruiter revoke or a finalize from another tab).
 *  Whatever this request minted stays on the server. The code names what happened:
 *  a finished screen is the single-use refusal, anything else is an inactive link. */
function refuseLeftLive(sessionId: string) {
  const stored = getInterviewSessionById(sessionId)?.status;
  return stored === "completed"
    ? jsonRefusal("INTERVIEW_ALREADY_COMPLETED", 409)
    : jsonRefusal("INTERVIEW_LINK_INACTIVE", 409);
}

// GET → which providers are configured (used by the UI to enable/disable the switcher).
export async function GET() {
  return NextResponse.json({ availability: voiceAvailability() });
}

// POST → mint short-lived browser credentials for the chosen provider and
// create/load the interview session. The browser connects directly afterward.
/** Hard cap on this public door's request body: a session token, a language tag and a consent flag — every field is coerced below.
 *  Enforced on the BYTES READ, not on the caller's content-length (request-body.ts). */
const MAX_CONNECT_BODY_BYTES = 16 * 1024;

export async function POST(request: NextRequest) {
  try {
    // Validate at the trust boundary instead of casting request.json() to a
    // typed shape (idea-c7df6b55): token must be a plausibly-sized string,
    // language must look like a language tag, consent must be literally true.
    const body = await readJsonWithLimit<Record<string, unknown>>(request, MAX_CONNECT_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_CONNECT_BODY_BYTES });
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

    // Atomic backstop for the checks above: if a /complete OR a revoke landed
    // between the status read and here, the guarded UPDATE (its from-set comes from
    // the transition table) refuses to reopen the session — and we must not mint
    // credentials for it.
    if (!markInterviewStarted(session.id, body.consent === true)) {
      return refuseLeftLive(session.id);
    }

    // The row AFTER the start: markInterviewStarted counted this connect, so its
    // `attempts` is the attempt this connect opens (1 on the first call, 2 after a
    // drop) — the number the browser stamps on every director POST.
    const started = getInterviewSessionById(session.id) ?? session;
    const attempt = started.attempts;

    // AUDIO recording is a separate, opt-in consent (spark ai-interview-parity): only
    // a workspace that OFFERS recording can have it given, and only a literal `true`
    // counts — the same trust-boundary rule as `consent` above. The offer is a
    // workspace setting read best-effort: failing to read it means "not offered".
    let recordingOffered = false;
    if (session.mode === "candidate") {
      try {
        recordingOffered = isInterviewRecordingOffered(session.workspaceId);
      } catch (offerErr) {
        // Not offering is the safe reading — no audio is ever kept on an unknown answer.
        console.error(`[interview:connect] recording offer unreadable for session ${session.id}:`, offerErr);
      }
    }
    if (recordingOffered && body.recordingConsent === true) {
      markInterviewRecordingConsent(session.id);
    }

    // ONE AGENDA FOR BOTH PROVIDERS (spark ai-interview-parity). Candidate-mode,
    // entry-backed sessions get the director's agenda built HERE, from the CURRENT
    // prep, READ-ONLY (this public door must never trigger a paid prep build), and
    // both briefs are composed from it: the private one OpenAI receives server-side
    // and the candidate-safe one ElevenLabs receives client-side. The session's
    // stored `instructions` snapshot stays the fallback whenever nothing can be built.
    // Every step is enrichment: a failure falls back, it never fails the call.
    let kit: InterviewKit | null = null;
    let resume: ResumeContext | null = null;
    let directedInstructions: string | null = null;
    let groundedCandidateBrief: string | null = null;
    if (session.mode === "candidate" && session.entryId) {
      try {
        resume = buildResumeContext(session.id, session.workspaceId);
      } catch (resumeErr) {
        // A reconnect without its resume state is a fresh-looking start — worse, but a call.
        console.error(`[interview:connect] resume context unreadable for session ${session.id}:`, resumeErr);
      }
      try {
        // Fitted to the session's BOOKED length — what the portal promised and what the
        // minutes debit clamps against — not to whatever the prep plans today. A
        // RESUMED attempt keeps the stored agenda: the resume state's block ids were
        // recorded against it (interview-agenda.ts::reconcileKitWithStoredAgenda).
        // `kitId` is the JOB KIT VERSION this link was PINNED to at mint — not the
        // job's latest published one: candidates in one round face the same questions
        // even when the recruiter publishes an edit mid-round.
        const fresh = await buildInterviewKit(session.entryId, undefined, {
          bookedMin: session.durationMin,
          kitId: session.kitId,
        });
        kit = reconcileKitWithStoredAgenda(fresh, started.agenda, resume !== null);
        // A post-await write: the row may have left live during the kit build. The
        // write is conditional, and a refusal ends the connect before any credential.
        if (kit && !setInterviewAgenda(session.id, kit.agenda)) return refuseLeftLive(session.id);
      } catch (agendaErr) {
        kit = null;
        console.error(`[interview:connect] agenda build failed for session ${session.id}:`, agendaErr);
      }
      try {
        const built = await buildGroundedInterview(session.entryId, undefined, { readOnly: true, kit, resume });
        directedInstructions = built.grounded ? built.instructions : null;
      } catch {
        /* grounding is enrichment — the stored snapshot below is the fallback */
      }
    }

    // A REHEARSAL of a job kit (spark interview-kit-template, WP-D — interview-rehearsal.ts):
    // a test-mode session with no entry, pinned at mint to one kit version, in the
    // recruiter's workspace. It gets what a candidate on a link pinned to that version
    // gets from the kit — the kit-only agenda fitted to the booked length, BOTH directed
    // briefs, the director's tools — and nothing only a candidate carries (no CV probes,
    // no overlay, no entry). Built from the session's own workspace and job; the
    // recruiter's language (this request's, else the one stored at mint) stands in for
    // the language a candidate chose at apply. A test session with NO kit — the lab —
    // never enters here and keeps its behaviour byte for byte. Enrichment like the branch
    // above: a failure falls back to the stored snapshot (and no tools), logged, because
    // the recruiter would otherwise be rehearsing something that is not their kit.
    const rehearsal = isKitRehearsal(session);
    if (rehearsal && session.kitId) {
      const locale = language ?? session.language;
      try {
        resume = buildResumeContext(session.id, session.workspaceId);
      } catch (resumeErr) {
        console.error(`[interview:connect] resume context unreadable for rehearsal ${session.id}:`, resumeErr);
      }
      try {
        const fresh = await buildKitOnlyInterviewKit(session.kitId, session.workspaceId, {
          bookedMin: session.durationMin,
          locale,
        });
        const reconciled = reconcileKitWithStoredAgenda(fresh, started.agenda, resume !== null);
        if (reconciled && session.jobId) {
          const briefs = buildRehearsalBriefs(session.jobId, reconciled, { locale, resume });
          kit = reconciled;
          directedInstructions = briefs.instructions;
          groundedCandidateBrief = briefs.candidateBrief;
          if (!setInterviewAgenda(session.id, kit.agenda)) return refuseLeftLive(session.id);
        } else {
          console.error(
            `[interview:connect] rehearsal ${session.id} has no directable kit (kit ${session.kitId}, job ${session.jobId}); ` +
              `running the stored snapshot instead.`
          );
        }
      } catch (rehearsalErr) {
        kit = null;
        directedInstructions = null;
        groundedCandidateBrief = null;
        console.error(`[interview:connect] kit rehearsal build failed for session ${session.id}:`, rehearsalErr);
      }
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
    if (session.mode === "candidate" && session.entryId) {
      try {
        groundedCandidateBrief = await buildCandidateSafeBrief(session.entryId, { kit, resume });
      } catch {
        /* grounding is enrichment — fall back to the generic candidate-safe prompt */
      }
    }
    // A resumed call on a FALLBACK prompt still hears that it is a resumption — the
    // addendum is candidate-safe (block ids/titles and the words said aloud only).
    const resumeNote = (text: string) => (resume ? `${text} ${resumeAddendum(resume, kit?.agenda ?? null)}` : text);
    const resolveAgentPrompt = (served: VoiceProviderId): string | null => {
      // A `prompt: "server"` provider is grounded server-side at mint: no client prompt.
      if (providerTraits(served).prompt !== "client-override") return null;
      // A rehearsal sends its candidate-safe brief exactly as a candidate's ElevenLabs
      // session would. Every other test session (the lab) keeps the dashboard agent's
      // own prompt — null, as it always has.
      if (session.mode !== "candidate") return rehearsal ? groundedCandidateBrief : null;
      return (
        groundedCandidateBrief ??
        resumeNote(defaultInterviewerInstructions({ role: session.jobTitle, durationMin: session.durationMin }))
      );
    };
    // The server-minted (OpenAI) brief: the directed build when there is one, else
    // the stored snapshot. The director's tools ride ONLY with a brief that carries
    // the protocol describing them — a tool the prompt never mentions is a tool the
    // model calls at random.
    const serverInstructions = directedInstructions ?? (session.mode === "candidate" ? resumeNote(instructions) : instructions);
    const directorTools = kit && directedInstructions ? DIRECTOR_TOOL_DEFS : null;

    // Provider failover (Direction 3): the session is already in_progress
    // (markInterviewStarted above, a single CAS — no double-start on failover). If
    // the preferred provider's connect throws and an alternate is available,
    // retry with it in THIS request (alternates in canonical order), building its brief via its own path above.
    // Single-provider deployments (or only the preferred configured) re-throw the
    // original error unchanged, so today's INTERVIEW_CONNECT_FAILED is preserved.
    const {
      provider: served,
      connect,
      agentPrompt,
      failedOver,
    } = await connectWithFailover({
      preferred: provider,
      instructions: serverInstructions,
      language: language ?? session.language,
      tools: directorTools,
      getAdapter: getVoiceAdapter,
      // A session that skipped /simulate's meterGate because the local provider is
      // free must never be rescued onto a PAID one — /complete would then price and
      // debit a call against a reservation that was never taken. connectWithFailover
      // HOLDS that rule itself (its isFree seam defaults to isSelfHostedProvider, and
      // failoverOrder offers a free preferred provider only free alternates), so the
      // availability passed here is the plain one; with no eligible alternate it
      // re-throws the original error, preserving INTERVIEW_CONNECT_FAILED exactly.
      availability: voiceAvailability(),
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
      // Conditional like every post-connect write: a revoke during the provider connect
      // leaves the row refusing, and the credentials just minted never leave here.
      if (!setInterviewSessionProvider(session.id, served, provider)) return refuseLeftLive(session.id);
      // An entry-backed session also leaves the fact on the candidate's timeline —
      // the same trail every other unattended action writes, so "why did this screen
      // run on ElevenLabs?" is answerable months later from the activity log rather
      // than from server logs that have long rotated. Best-effort: the audit marker
      // must never fail a call the candidate is waiting on. A CANDIDATE interview only
      // (interview-rehearsal.ts): a test session — a rehearsal, a lab call — writes
      // nothing onto anyone's timeline, even one that somehow carries an entry.
      if (isCandidateInterview(session)) {
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
    // enforced at the source in interviewAsrKeywords. A provider whose trait row
    // declares no `asrKeywords` (OpenAI: transcription configured server-side) gets
    // null. A rehearsal has no entry to find the job through, so it reads the job it
    // was minted for — the same public terms a candidate on that job gets.
    const asrKeywords = providerTraits(served).asrKeywords
      ? rehearsal
        ? jobAsrKeywords(session.jobId)
        : interviewAsrKeywords(session.entryId)
      : null;

    // THE LAST GATE before credentials leave (scan-sweep challenge r02). Everything
    // above ran seconds of awaits after the start — kit builds, the grounded brief,
    // the provider connect — and a recruiter's revoke in that window used to end with
    // fresh provider credentials in the browser anyway. Nothing awaits between this
    // check and the return, so it is the compare step of the handoff.
    if (!isInterviewSessionStillLive(session.id)) return refuseLeftLive(session.id);

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
      // The director's agenda as a PROJECTION (toCandidateAgendaView): block ids,
      // kinds, candidate-safe titles and budgets — never the competencies or the
      // questions the stored agenda carries. Null when nothing is directed.
      agenda: kit ? toCandidateAgendaView(kit.agenda) : null,
      attempt,
      // What a resumed attempt continues from: block ids and the earlier attempts'
      // turns, which are exactly the turns this browser itself posted to the director
      // — nothing server-private (voice/resume.ts reads only `turn` events).
      resume,
      recording: { offered: recordingOffered },
    });
  } catch (error) {
    // Adapter errors embed upstream provider HTTP bodies (OpenAI client_secrets
    // / ElevenLabs signed-url responses) — internal detail that must not reach
    // the client (idea-ab117371). The not-configured 503 above stays specific:
    // its message is already client-safe by construction.
    return safeJsonError(error, "api:interview:connect", "INTERVIEW_CONNECT_FAILED");
  }
}
