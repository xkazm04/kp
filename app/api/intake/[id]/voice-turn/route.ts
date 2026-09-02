import { NextRequest, NextResponse } from "next/server";
import { getIntake, updateIntakeDialog } from "@/app/_lib/db/intakes";
import { runIntakeVoiceTurn } from "@/app/_lib/intake-run";
import { stripEndSentinel } from "../../reply-sentinel";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

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
    if (!intake) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    if (intake.status !== "open") return jsonRefusal("INTAKE_CLOSED", 409);
    const body = (await request.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_UTTERANCE_CHARS) : "";
    if (!message) return jsonRefusal("INTAKE_TEXT_REQUIRED", 400);

    // THROTTLE (rate-limit-contract.test.ts): each accepted utterance is a paid
    // (fast-model) LLM call. Speech pacing is quicker than typing — 60/10min per
    // intake is one utterance per 10s sustained, ~2x a natural spoken exchange
    // (say a sentence, hear a reply, answer), while a scripted loop is pinned.
    // Keyed by intake id (operator retries share the office NAT). After the
    // 404/409/400 refusals, before the DB write + model call.
    if (!rateLimit(`intake-voice-turn:${id}`, { limit: 60, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    const lang = intake.lang === "cs" ? "cs" : "en";
    // The signal rides into the spawn: a hung-up call must not leave a paid
    // fast-model completion running for an utterance nobody will hear answered.
    const turn = await runIntakeVoiceTurn(
      { transcript: intake.transcript, brief: intake.brief, message, lang, attachments: intake.attachments },
      request.signal
    );

    // Strip the <<END>> close sentinel exactly like /message — here it matters
    // MORE, not less: this reply is handed to the transport, which is told to
    // say it "exactly, verbatim" (speakText), so the unstripped token was the
    // last thing the requestor HEARD on every closed call (the scripted
    // keyless close always carries it), was persisted into the transcript, and
    // would be spoken again as `spokenOpener` on the next connect. `done` is
    // already carried by turn.done — the token itself is pure wire contract.
    const reply = stripEndSentinel(turn.reply);
    const now = new Date().toISOString();
    const transcript = [
      ...intake.transcript,
      { role: "candidate" as const, text: message, at: now },
      { role: "interviewer" as const, text: reply, at: now },
    ];
    // Deterministic fast thread extracted inline → persist its brief; the LLM
    // path leaves the stored brief for the periodic extraction thread.
    const brief = turn.brief ?? intake.brief;
    const briefTitle = typeof brief?.title === "string" ? brief.title : "";
    // COMPARE-AND-SWAP over the version read before the spawn: the text plane and
    // the extraction sweep write the same row, and a blind write here reverted
    // whichever of them landed first. `moved` is not a fault — the client re-reads
    // rather than overwriting (intake-dialog-cas.test.ts).
    const write = updateIntakeDialog(
      id,
      {
        transcript,
        brief,
        ...(briefTitle ? { title: briefTitle } : {}),
        // A spoken, confirmed close is a real close — same contract as text.
        ...(turn.done ? { status: "complete" as const } : {}),
        expectedUpdatedAt: intake.updatedAt,
      },
      ws
    );
    if (write === "missing") return jsonRefusal("INTAKE_NOT_FOUND", 404);
    if (write === "moved") return jsonRefusal("INTAKE_BRIEF_MOVED", 409);
    return NextResponse.json({
      reply,
      done: turn.done,
      source: turn.source,
      ...(turn.brief ? { brief: turn.brief } : {}),
      ...(turn.fallbackReason ? { fallbackReason: turn.fallbackReason } : {}),
    });
  } catch (error) {
    // A hang-up mid-turn is a decision, not a fault.
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    return safeJsonError(error, "api:intake/voice-turn", "INTAKE_VOICE_TURN_FAILED");
  }
}
