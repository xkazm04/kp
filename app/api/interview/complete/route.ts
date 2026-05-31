import { NextRequest, NextResponse } from "next/server";
import { completeInterviewSession, getInterviewSessionById, type InterviewTurn } from "@/app/_lib/db";
import { runInterviewScorecard } from "@/app/_lib/interview-run";

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

    const transcript: InterviewTurn[] = Array.isArray(body.transcript)
      ? body.transcript
          .filter((t) => t && typeof t.text === "string")
          .map((t) => ({
            role: t.role === "candidate" || t.role === "interviewer" ? t.role : "system",
            text: String(t.text).slice(0, 4000),
            at: t.at,
          }))
      : [];

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "complete failed" },
      { status: 500 }
    );
  }
}
