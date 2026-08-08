import { NextRequest, NextResponse } from "next/server";
import { getIntake, updateIntakeDialog } from "@/app/_lib/db/intakes";
import { runIntakeVoiceTurn } from "@/app/_lib/intake-run";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { safeJsonError } from "@/app/_lib/api-response";

const MAX_UTTERANCE_CHARS = 4_000;

// POST /api/intake/[id]/voice-turn — the FAST voice thread
// (docs/architecture/voice-conversation-plane.md): the transport delivered one
// transcribed requestor utterance; OUR engine produces the next spoken
// utterance. The exchange persists immediately (transcript is server truth —
// a transport swap or drop mid-call loses nothing), and the reply text goes
// back for the transport to speak. Brief extraction does NOT run here — the
// periodic extraction thread (voice-complete without turns) owns it — except
// on the deterministic path, whose scripted engine extracts inline for free.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const intake = getIntake(id, ws);
    if (!intake) return NextResponse.json({ error: "Intake not found." }, { status: 404 });
    if (intake.status !== "open") {
      return NextResponse.json({ error: "This intake session is closed." }, { status: 409 });
    }
    const body = (await request.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_UTTERANCE_CHARS) : "";
    if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

    // THROTTLE (rate-limit-contract.test.ts): each accepted utterance is a paid
    // (fast-model) LLM call. Speech pacing is quicker than typing — 60/10min per
    // intake is one utterance per 10s sustained, ~2x a natural spoken exchange
    // (say a sentence, hear a reply, answer), while a scripted loop is pinned.
    // Keyed by intake id (operator retries share the office NAT). After the
    // 404/409/400 refusals, before the DB write + model call.
    if (!rateLimit(`intake-voice-turn:${id}`, { limit: 60, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }

    const lang = intake.lang === "cs" ? "cs" : "en";
    const turn = await runIntakeVoiceTurn({ transcript: intake.transcript, brief: intake.brief, message, lang, attachments: intake.attachments });

    const now = new Date().toISOString();
    const transcript = [
      ...intake.transcript,
      { role: "candidate" as const, text: message, at: now },
      { role: "interviewer" as const, text: turn.reply, at: now },
    ];
    // Deterministic fast thread extracted inline → persist its brief; the LLM
    // path leaves the stored brief for the periodic extraction thread.
    const brief = turn.brief ?? intake.brief;
    const briefTitle = typeof brief?.title === "string" ? brief.title : "";
    updateIntakeDialog(
      id,
      {
        transcript,
        brief,
        ...(briefTitle ? { title: briefTitle } : {}),
        // A spoken, confirmed close is a real close — same contract as text.
        ...(turn.done ? { status: "complete" as const } : {}),
      },
      ws
    );
    return NextResponse.json({
      reply: turn.reply,
      done: turn.done,
      source: turn.source,
      ...(turn.brief ? { brief: turn.brief } : {}),
      ...(turn.fallbackReason ? { fallbackReason: turn.fallbackReason } : {}),
    });
  } catch (error) {
    return safeJsonError(error, "api:intake/voice-turn", "INTAKE_VOICE_TURN_FAILED");
  }
}
