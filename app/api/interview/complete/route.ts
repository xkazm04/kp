import { NextRequest, NextResponse } from "next/server";
import { completeInterviewSession, getInterviewSessionById, type InterviewTurn } from "@/app/_lib/db";
import { runInterviewScorecard } from "@/app/_lib/interview-run";
import { clampTurn } from "@/app/_lib/interview-transcript";
import { jsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

// POST → end of call: persist the transcript (transcript-only, no audio). When
// the session is linked to a pipeline entry, also synthesize the scorecard
// (Task 5) from the transcript and set the scorecard_review approval, so it
// lands in the Decisions queue for the human Interview→Offer gate.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      transcript?: InterviewTurn[];
      status?: string;
    };
    if (!body.sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    const session = getInterviewSessionById(body.sessionId);
    if (!session) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

    // Normalize + clamp each turn to MAX_TURN_TEXT_CHARS (documented sanity cap;
    // see app/_lib/interview-transcript.ts). Track turns whose tail was actually
    // discarded so an abnormally long turn is visible rather than silent.
    let clippedTurns = 0;
    let clippedChars = 0;
    const transcript: InterviewTurn[] = Array.isArray(body.transcript)
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
    // transcript is always saved even if scoring fails).
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
