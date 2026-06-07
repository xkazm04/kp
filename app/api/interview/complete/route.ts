import { NextRequest, NextResponse } from "next/server";
import { completeInterviewSession, getInterviewSessionById, type VoiceTurn } from "@/app/_lib/db";
import { runInterviewScorecard } from "@/app/_lib/interview-run";
import { capTranscriptTurns, clampTurn } from "@/app/_lib/interview-transcript";
import { jsonError } from "@/app/_lib/api-response";
import { CONSENT_NOT_RECORDED_ERROR, isPersistConsentSatisfied } from "@/app/_lib/interview-consent";

export const runtime = "nodejs";

// POST → end of call: persist the transcript (transcript-only, no audio). When
// the session is linked to a pipeline entry, also synthesize the scorecard
// (Task 5) from the transcript and set the scorecard_review approval, so it
// lands in the Decisions queue for the human Interview→Offer gate.
export async function POST(request: NextRequest) {
  try {
    // Validate at the trust boundary instead of casting request.json() to a
    // typed shape (idea-c7df6b55): sessionId must be a plausibly-sized string
    // and the transcript a bounded array — turn COUNT is capped below alongside
    // the existing per-turn text clamp, so a crafted multi-thousand-turn POST
    // can't persist a multi-megabyte transcript_json.
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = typeof body.sessionId === "string" && body.sessionId.length <= 120 ? body.sessionId : null;
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    const session = getInterviewSessionById(sessionId);
    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
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

    // Synthesize the scorecard for candidate-mode sessions (best-effort: the
    // transcript is always saved even if scoring fails). Gating on "completed"
    // is load-bearing: a call that dropped abnormally (provider/network error or
    // a never-live connect) finalizes as "failed" (idea-3abeeb5f), so its
    // truncated transcript is NEVER scored and never sets the scorecard_review
    // approval that feeds the Interview→Offer gate.
    let scorecard: Record<string, unknown> | null = null;
    if (session.entryId && status === "completed" && transcript.length > 0) {
      try {
        scorecard = await runInterviewScorecard(session.entryId, transcript);
      } catch {
        /* transcript still persists below */
      }
    }

    const updated = completeInterviewSession(sessionId, {
      transcript,
      scorecard: scorecard ?? undefined,
      status,
    });
    return NextResponse.json({ ok: true, session: updated, scorecard });
  } catch (error) {
    return jsonError(error, "complete failed");
  }
}
