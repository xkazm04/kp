import { NextRequest, NextResponse } from "next/server";
import { recordMeterUsage } from "@/app/_lib/billing";
import { maxBillableInterviewMin } from "@/app/_lib/billing/enforce";
import { attachInterviewScorecard, completeInterviewSession, getInterviewSessionByToken, type InterviewSession, type VoiceTurn } from "@/app/_lib/db/interviews";
import { insertLlmUsage } from "@/app/_lib/db/llm";
import { getEntryWorkspace } from "@/app/_lib/db/pipeline";
import { voiceUsageRow } from "@/app/_lib/voice/minute-prices";
import { isSelfHostedProvider } from "@/app/_lib/voice";
import { runInterviewScorecard } from "@/app/_lib/interview-run";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { AUTOMATION_VERSION } from "@/app/_lib/automation-run";
import { capTranscriptTurns, clampTurn } from "@/app/_lib/interview-transcript";
import { safeJsonError } from "@/app/_lib/api-response";
import { CONSENT_NOT_RECORDED_ERROR, isPersistConsentSatisfied } from "@/app/_lib/interview-consent";


// PUBLIC TOKEN ROUTE — the response carries a PROJECTION, not the store row
// (the `publicInviteView` rule the sibling candidate surfaces follow). Every
// return below used to serialize the whole InterviewSession under `session`, so
// the candidate's OWN hang-up POST answered with the recruiter's PRIVATE
// material: `instructions` is the interviewer brief — prep-chronology goals, the
// role-intake hiring-intent digest, and on a submission debrief literal
// “Internal red flag — never say this aloud: …” lines (interview-run.ts) — and
// `runOfShow` carries the same gap annotations (“(missing must-have)”) that
// connect-response-contract.test.ts already forbids on the /connect response.
// /connect was held to that line; /complete was the back door, one Network tab
// away. The allow-list below is what the wire actually needs: the browser reads
// only `res.ok`, and the voice eval harness reads `session.transcript` — the
// candidate's own words, which stay.
type PublicSessionView = {
  id: string;
  status: string;
  mode: "test" | "candidate";
  durationMin: number | null;
  startedAt: string | null;
  endedAt: string | null;
  transcript: VoiceTurn[] | null;
};

function publicSessionView(session: InterviewSession | null): PublicSessionView | null {
  if (!session) return null;
  return {
    id: session.id,
    status: session.status,
    mode: session.mode,
    durationMin: session.durationMin,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    transcript: session.transcript,
  };
}

// POST → end of call: persist the transcript (transcript-only, no audio). When
// the session is linked to a pipeline entry, also synthesize the scorecard
// (Task 5) from the transcript and set the scorecard_review approval, so it
// lands in the Decisions queue for the human Interview→Offer gate.
export async function POST(request: NextRequest) {
  try {
    // Validate at the trust boundary instead of casting request.json() to a
    // typed shape (idea-c7df6b55): token must be a plausibly-sized string and
    // the transcript a bounded array — turn COUNT is capped below alongside
    // the existing per-turn text clamp, so a crafted multi-thousand-turn POST
    // can't persist a multi-megabyte transcript_json.
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // Completion must present the session TOKEN, not just a sessionId
    // (idea-5248c3e9). Looking the session up purely by a client-supplied id
    // bound the write to nothing: an outsider who knew or guessed an id could
    // inject an attacker-authored transcript that feeds the Interview→Offer
    // scorecard (write-side IDOR + business-logic tampering). The token is the
    // session's actual capability — the same credential that gates the public
    // interview page — so it is the lookup key; a sessionId, when sent, is
    // cross-checked against the token's session and never trusted alone.
    const token = typeof body.token === "string" && body.token.length <= 200 ? body.token : null;
    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }
    const session = getInterviewSessionByToken(token);
    if (!session || (typeof body.sessionId === "string" && body.sessionId !== session.id)) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    const sessionId = session.id;

    // Idempotency / terminal-state guard (idea-beb71894): a completed session is
    // done — a duplicate POST (network retry, second tab, provider disconnect
    // racing a manual End) must neither overwrite the persisted transcript nor
    // re-run the scorecard that gates Interview→Offer. Return the stored state
    // as success so a retrying client settles instead of erroring.
    if (session.status === "completed") {
      return NextResponse.json({
        ok: true,
        alreadyCompleted: true,
        session: publicSessionView(session),
        scorecard: session.scorecard ?? null,
      });
    }

    // Consent invariant (idea-98e6cf23): never persist a candidate transcript
    // unless consent was recorded server-side (consent_at non-null). /connect
    // already gates the start, so this is defense in depth against a bypassed or
    // legacy session — storage only proceeds when "we have consent" is a fact in
    // the row, not an assumption.
    if (!isPersistConsentSatisfied(session.mode, session.consentAt)) {
      return NextResponse.json({ error: CONSENT_NOT_RECORDED_ERROR }, { status: 403 });
    }

    // Normalize + clamp each turn to MAX_TURN_TEXT_CHARS (documented sanity cap;
    // see app/_lib/interview-transcript.ts). Track turns whose tail was actually
    // discarded so an abnormally long turn is visible rather than silent.
    let clippedTurns = 0;
    let clippedChars = 0;
    const clamped: VoiceTurn[] = Array.isArray(body.transcript)
      ? (body.transcript as unknown[])
          .filter((t): t is { text: string } => typeof t === "object" && t !== null && typeof (t as { text?: unknown }).text === "string")
          .map((t) => {
            const { turn, clippedChars: clip } = clampTurn(t);
            if (clip > 0) {
              clippedTurns += 1;
              clippedChars += clip;
            }
            return turn;
          })
      : [];
    if (clippedTurns > 0) {
      console.warn(
        `[interview:complete] clamped ${clippedTurns} oversized turn(s) for session ${sessionId} ` +
          `(${clippedChars} chars discarded; per-turn cap).`
      );
    }
    // Turn-count cap (head+tail keep, in-band marker — see interview-transcript.ts).
    const { turns: transcript, droppedTurns } = capTranscriptTurns(clamped);
    if (droppedTurns > 0) {
      console.warn(
        `[interview:complete] capped transcript for session ${sessionId}: ` +
          `dropped ${droppedTurns} middle turn(s) at the persistence cap.`
      );
    }

    // Defense in depth (voice-interview #1): `status` is client-supplied, and the
    // AI interviewer always opens, so a silent-mic call (hardware fault, OS mute,
    // VAD never firing) can arrive here as "completed" with a transcript that holds
    // only interviewer turns. Never score such a call: downgrade to "failed" so
    // scoring is skipped, minutes stay unbilled, and the candidate keeps access to
    // their link instead of being locked out of an empty interview.
    const candidateTurns = transcript.filter((t) => t.role === "candidate").length;
    const dropped = body.status === "failed" || candidateTurns === 0;
    // A REVOKED session stays revoked (scan-sweep 2026-08-22). Revoke is the
    // recruiter pulling the link — "wrong candidate, changed mind, link shared too
    // widely" (the drawer's Revoke-links action) or /create's `force` reissue — and
    // it CANNOT hang up a call already in flight: the browser holds a direct
    // provider connection, so the candidate's own hang-up POST still lands here.
    // Unguarded, that finalize flipped the row to 'completed', which (a) debited the
    // workspace's interview minutes, (b) synthesized a scorecard and (c) SEALED an
    // `ai_scorecard` decision on the pipeline entry — an AI verdict about a named
    // person, feeding the Interview→Offer gate, out of the interview the recruiter
    // had just killed. Worse, 'completed' silently UNDID the revoke as a lifecycle
    // fact, and the same row then surfaced in the compare grid (interviewedForJob
    // selects status='completed').
    // Keeping the status 'revoked' rather than downgrading to 'failed' is
    // load-bearing: 'failed' is reconnectable BY DESIGN, so it would hand the link
    // back to the candidate and let them mint fresh provider credentials on a
    // credential the recruiter had revoked. The transcript is still persisted below
    // — what was said is evidence, and destroying it is not ours to do — while the
    // three "this interview counts" side effects (all gated on status ===
    // "completed") are skipped, exactly as they are for a silent-mic call.
    const status = session.status === "revoked" ? "revoked" : dropped ? "failed" : "completed";

    // Never replace a persisted non-empty transcript with an empty one
    // (idea-beb71894): a stray empty/failed finalize after a real one (e.g. a
    // reloaded tab tearing down) is data loss a recruiter cannot recover.
    if (transcript.length === 0 && (session.transcript?.length ?? 0) > 0) {
      return NextResponse.json({
        ok: true,
        alreadyCompleted: true,
        session: publicSessionView(session),
        scorecard: session.scorecard ?? null,
      });
    }

    // Persist the transcript FIRST (idea-55fd89f9). The old order ran the
    // scorecard — which sets the scorecard_review approval driving the
    // Interview→Offer gate — before the transcript write, so a failed write
    // (DB lock, SQLITE_BUSY) after successful scoring left a scored,
    // offer-ready entry whose transcript modal showed nothing: a phantom gate
    // approval with no evidence behind it. Now the durable artifact lands
    // before any scoring side effect can exist.
    const { session: persisted, applied } = completeInterviewSession(sessionId, { transcript, status });
    if (!applied) {
      // A concurrent completion won the row-level guard — its transcript stands.
      return NextResponse.json({
        ok: true,
        alreadyCompleted: true,
        session: publicSessionView(persisted),
        scorecard: persisted?.scorecard ?? null,
      });
    }

    // Billing debit (docs/features/billing/README.md): interview minutes are metered on the
    // completion whose write APPLIED (the row-level guard above also makes the
    // debit idempotent across duplicate POSTs) and only for real "completed"
    // calls — a dropped/failed call doesn't bill. Minutes = wall time from
    // consent-gated start, clamped to [1, 2× the booked length] so a clock
    // anomaly can't drain the meter; no start timestamp falls back to the
    // booked duration.
    if (status === "completed") {
      const bookedMin = session.durationMin ?? 8;
      // Bill THIS attempt, not the whole life of the link. markInterviewStarted
      // COALESCEs started_at, so it keeps the FIRST connect — deliberate, that is
      // when the consent-gated conversation began — but a 'failed' session stays
      // reconnectable BY DESIGN (a dropped call should be retryable), and a
      // candidate who retries the next day was billed from the original start:
      // elapsed ran to ~1500 minutes and clamped straight to the 2× ceiling, so an
      // 18-minute call debited 40 minutes (plus the matching inflated cost estimate)
      // on the one meter with real per-unit cost. updated_at is re-stamped by EVERY
      // markInterviewStarted (and by nothing else while a call is live), so the
      // later of the two timestamps is when the current attempt actually started.
      // On a single-attempt session both are the same write, so the number is
      // unchanged. The earlier, failed attempt stays unbilled — the existing rule.
      // Read only while the row is still `in_progress`: that is precisely when the
      // last write WAS a connect. On a 'failed'/'created' row updated_at is an END
      // (or absent) timestamp, and trusting it there would under-bill to the
      // 1-minute floor — so those keep the started_at reading.
      const startedMs = session.startedAt ? Date.parse(session.startedAt) : NaN;
      const touchedMs =
        session.status === "in_progress" && session.updatedAt ? Date.parse(session.updatedAt) : NaN;
      const attemptMs =
        Number.isFinite(touchedMs) && (!Number.isFinite(startedMs) || touchedMs > startedMs) ? touchedMs : startedMs;
      const elapsedMin = Number.isFinite(attemptMs) ? Math.ceil((Date.now() - attemptMs) / 60_000) : bookedMin;
      // The 2× ceiling is single-sourced (maxBillableInterviewMin) so /create can
      // RESERVE exactly this amount — gate and debit read one function, never two
      // different numbers (the reserve-vs-debit bug this seam closes).
      const billedMin = Math.min(Math.max(elapsedMin, 1), maxBillableInterviewMin(bookedMin));
      // Org attribution (org-plan Phase 3): a token-driven flow has no session
      // cookie, so the tenant comes from the SESSION ROW, which was stamped at create
      // time (from the pipeline entry, or from the caller for an entry-less
      // simulation). This used to re-derive it from `session.entryId` and default when
      // there was none, so every simulation debited the DEFAULT team's meter while its
      // gate had checked the caller's — gate and debit on two different tenants.
      // ...and only for a session a PAID provider served. /api/interview/simulate
      // deliberately skips meterGate for a self-hosted (free) provider — "metering a
      // free simulation would make a self-hosted install run out of a budget it is not
      // consuming, which is the whole reason to self-host" — but this debit used to run
      // unconditionally, so an 18-minute free local call drained 18 minutes of prepaid
      // quota and a later HOSTED call was 402'd on an allowance the free ones spent.
      // Gate and debit now agree on the same predicate (scan-sweep 2026-08-22).
      // session.provider is trustworthy here: it is set to whoever actually served, and
      // /connect no longer lets a free session fail over onto a paid provider.
      // The llm_usage row below stays UNCONDITIONAL — voiceMinuteCostUsd already prices
      // these at 0, and a $0 ledger row is the truthful record that a call happened.
      if (!isSelfHostedProvider(session.provider)) {
        recordMeterUsage("interview_minutes", billedMin, new Date(), session.workspaceId);
      }
      // Cost attribution (tiger F1): the meter above is a quantity-only quota
      // counter, but OpenAI Realtime vs ElevenLabs per-minute costs differ
      // materially — so the SAME billed minutes also land in the llm_usage
      // ledger with provider/model and a duration-derived cost estimate
      // (voice/minute-prices.ts), where the Models usage panel aggregates them
      // like every other LLM call. Best-effort: ledger telemetry never blocks
      // a completion whose transcript is already persisted.
      try {
        insertLlmUsage(voiceUsageRow(session, billedMin));
      } catch {
        /* ledger write is telemetry — completion already succeeded */
      }
    }

    // Synthesize the scorecard for candidate-mode sessions (best-effort: the
    // transcript is already safe above if scoring fails). Gating on "completed"
    // is load-bearing: a call that dropped abnormally (provider/network error or
    // a never-live connect) finalizes as "failed" (idea-3abeeb5f), so its
    // truncated transcript is NEVER scored and never sets the scorecard_review
    // approval that feeds the Interview→Offer gate. Running this only on the
    // call whose write applied also means a duplicate POST can't double-score.
    let scorecard: Record<string, unknown> | null = null;
    let updated = persisted;
    if (session.entryId && status === "completed" && transcript.length > 0) {
      // Token-driven flow (no session workspace): derive the entry's team so the scorecard
      // + its Interview→Offer approval scope to the right tenant.
      const ws = getEntryWorkspace(session.entryId);
      try {
        scorecard = await runInterviewScorecard(session.entryId, transcript, ws);
      } catch {
        /* transcript is already persisted — scoring is best-effort */
      }
      if (scorecard) {
        updated = attachInterviewScorecard(sessionId, scorecard) ?? updated;
        // Decision SoR (moonshot D backfill): seal the AI scorecard verdict with
        // its model/prompt version as the actor. Best-effort — never blocks complete.
        const rec = typeof scorecard.recommendation === "string" ? scorecard.recommendation : "(none)";
        sealDecisionSafe({
          kind: "ai_scorecard",
          actor: `auto:${AUTOMATION_VERSION.scorecard}`,
          policyVersion: AUTOMATION_VERSION.scorecard,
          candidateRef: session.entryId,
          rationale: `AI interview scorecard — recommendation: ${rec}.`,
          reasonCode: "scorecard",
          inputs: { recommendation: rec },
        });
      }
    }

    return NextResponse.json({ ok: true, session: publicSessionView(updated), scorecard });
  } catch (error) {
    return safeJsonError(error, "api:interview:complete", "INTERVIEW_COMPLETE_FAILED");
  }
}
