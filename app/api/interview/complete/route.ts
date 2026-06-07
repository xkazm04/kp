import { NextRequest, NextResponse } from "next/server";
import { completeInterviewSession, getInterviewSessionById, type VoiceTurn } from "@/app/_lib/db";
import { runInterviewScorecard } from "@/app/_lib/interview-run";
import { clampTurn } from "@/app/_lib/interview-transcript";
import { jsonError } from "@/app/_lib/api-response";
import { CONSENT_NOT_RECORDED_ERROR, isPersistConsentSatisfied } from "@/app/_lib/interview-consent";

export const runtime = "nodejs";

// POST → end of call: persist the transcript (transcript-only, no audio). When
// the session is linked to a pipeline entry, also synthesize the scorecard
// (Task 5) from the transcript and set the scorecard_review approval, so it
// lands in the Decisions queue for the human Interview→Offer gate.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      transcript?: VoiceTurn[];
      status?: string;
    };
    if (!body.sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    const session = getInterviewSessionById(body.sessionId);
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
    const transcript: VoiceTurn[] = Array.isArray(body.transcript)
      ? body.transcript
          .filter((t) => t && typeof t.text === "string")
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
        `[interview:complete] clamped ${clippedTurns} oversized turn(s) for session ${body.sessionId} ` +
          `(${clippedChars} chars discarded; per-turn cap).`
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

    const updated = completeInterviewSession(body.sessionId, {
      transcript,
      scorecard: scorecard ?? undefined,
      status,
    });
    return NextResponse.json({ ok: true, session: updated, scorecard });
  } catch (error) {
    return jsonError(error, "complete failed");
  }
}
