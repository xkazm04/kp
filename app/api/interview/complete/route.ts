import { NextRequest, NextResponse } from "next/server";
import { recordMeterUsage } from "@/app/_lib/billing";
import {
  attachInterviewScorecard,
  completeInterviewSession,
  getInterviewSessionByToken,
  insertLlmUsage,
  type VoiceTurn,
} from "@/app/_lib/db";
import { voiceUsageRow } from "@/app/_lib/voice/minute-prices";
import { runInterviewScorecard } from "@/app/_lib/interview-run";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { AUTOMATION_VERSION } from "@/app/_lib/automation-run";
import { capTranscriptTurns, clampTurn } from "@/app/_lib/interview-transcript";
import { safeJsonError } from "@/app/_lib/api-response";
import { CONSENT_NOT_RECORDED_ERROR, isPersistConsentSatisfied } from "@/app/_lib/interview-consent";


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
        session,
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

    const status = body.status === "failed" ? "failed" : "completed";

    // Never replace a persisted non-empty transcript with an empty one
    // (idea-beb71894): a stray empty/failed finalize after a real one (e.g. a
    // reloaded tab tearing down) is data loss a recruiter cannot recover.
    if (transcript.length === 0 && (session.transcript?.length ?? 0) > 0) {
      return NextResponse.json({
        ok: true,
        alreadyCompleted: true,
        session,
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
        session: persisted,
        scorecard: persisted?.scorecard ?? null,
      });
    }

    // Billing debit (docs/BILLING.md): interview minutes are metered on the
    // completion whose write APPLIED (the row-level guard above also makes the
    // debit idempotent across duplicate POSTs) and only for real "completed"
    // calls — a dropped/failed call doesn't bill. Minutes = wall time from
    // consent-gated start, clamped to [1, 2× the booked length] so a clock
    // anomaly can't drain the meter; no start timestamp falls back to the
    // booked duration.
    if (status === "completed") {
      const bookedMin = session.durationMin ?? 8;
      const startedMs = session.startedAt ? Date.parse(session.startedAt) : NaN;
      const elapsedMin = Number.isFinite(startedMs) ? Math.ceil((Date.now() - startedMs) / 60_000) : bookedMin;
      const billedMin = Math.min(Math.max(elapsedMin, 1), bookedMin * 2);
      recordMeterUsage("interview_minutes", billedMin);
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
      try {
        scorecard = await runInterviewScorecard(session.entryId, transcript);
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

    return NextResponse.json({ ok: true, session: updated, scorecard });
  } catch (error) {
    return safeJsonError(error, "api:interview:complete", "INTERVIEW_COMPLETE_FAILED");
  }
}
