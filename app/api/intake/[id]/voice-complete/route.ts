import { NextRequest, NextResponse } from "next/server";
import { getIntake, updateIntakeDialog } from "@/app/_lib/db/intakes";
import { runIntakeTranscriptExtract } from "@/app/_lib/intake-run";
import { capTranscriptTurns, clampTurn } from "@/app/_lib/interview-transcript";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { safeJsonError } from "@/app/_lib/api-response";

// POST /api/intake/[id]/voice-complete — the PERIODIC EXTRACTION THREAD of the
// two-thread voice design (docs/architecture/voice-conversation-plane.md) and
// the drop-recovery path in one route:
//
// * WITHOUT `turns` (the normal periodic call, fired by the client every few
//   exchanges and at hang-up): run ONE batch extraction over the transcript
//   ALREADY STORED by /voice-turn — the live brief panel fills DURING the
//   call, a turn or two behind the conversation (honest lag by design).
// * WITH `turns` (recovery — a dropped call whose per-turn posts didn't land):
//   append the posted turns first, then extract. v1's hang-up-only behavior.
//
// Extraction runs pipeline/jobfit/intake.py::extract_transcript —
// merge-protected like every text exchange. Keyless it honestly declines
// (extracted: false): transcript preserved, brief untouched. The session never
// closes here — the close travels through /voice-turn (spoken confirm) or the
// text plane.

const MAX_VOICE_TURNS = 400;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const intake = getIntake(id, ws);
    if (!intake) return NextResponse.json({ error: "Intake not found." }, { status: 404 });
    // A CLOSED (`complete`) session still accepts this call — it is the only
    // route that can. /voice-turn flips the session to `complete` on a
    // confirmed spoken read-back BEFORE the client's closing sweep fires
    // (completeTurn() sets `extract: true` on the closing turn, and finish()
    // posts the recovery `turns` right after), so refusing anything that is
    // not `open` rejected the LAST extraction of every voice call — the LLM
    // fast thread never extracts, so the closing exchanges never reached the
    // brief — and threw away the stray turns the recovery payload carries,
    // while the requestor saw a red "failed" note on a call that succeeded.
    // Only `promoted` stays frozen (the JD exists — same rule as brief and
    // attachments), and this route still never CLOSES a session itself.
    if (intake.status !== "open" && intake.status !== "complete") {
      return NextResponse.json({ error: "This session was promoted — its record is frozen." }, { status: 409 });
    }
    const body = (await request.json().catch(() => ({}))) as { turns?: unknown };
    const rawTurns = Array.isArray(body.turns) ? body.turns.slice(0, MAX_VOICE_TURNS) : [];
    // Same trust-boundary clamps as the interview /complete route: per-turn
    // role/text/at coercion, then the global cap with honest drop accounting.
    const clamped = rawTurns
      .map((t) => clampTurn((t ?? {}) as { role?: unknown; text: unknown; at?: unknown }).turn)
      .filter((t) => t.text.trim().length > 0);
    const { turns } = capTranscriptTurns(clamped);
    if (turns.length === 0 && intake.transcript.length === 0) {
      return NextResponse.json({ error: "nothing to extract yet" }, { status: 400 });
    }

    // THROTTLE (rate-limit-contract.test.ts): each accepted call runs one paid
    // batch extraction. 20/10min per IP — the periodic thread fires every few
    // exchanges of a live call (a long coaching call legitimately reaches
    // double digits), while a scripted loop stays pinned. After the cheap
    // refusals, before the DB write + model call.
    if (!rateLimit(`intake-voice-complete:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }

    const lang = intake.lang === "cs" ? "cs" : "en";
    const transcript = [...intake.transcript, ...turns];
    // Attachments ride along: the fast voice thread sees titles only, so this
    // extraction sweep is where attached bodies actually reach the model.
    const result = await runIntakeTranscriptExtract({ transcript, brief: intake.brief, lang, attachments: intake.attachments });
    const briefTitle = typeof result.brief?.title === "string" ? result.brief.title : "";
    updateIntakeDialog(
      id,
      {
        transcript,
        brief: result.extracted ? result.brief : intake.brief,
        shape: result.shape,
        ...(briefTitle && result.extracted ? { title: briefTitle } : {}),
      },
      ws
    );
    return NextResponse.json({
      transcript,
      brief: result.extracted ? result.brief : intake.brief,
      shape: result.shape,
      extracted: result.extracted,
      source: result.source,
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    });
  } catch (error) {
    return safeJsonError(error, "api:intake/voice-complete", "INTAKE_VOICE_COMPLETE_FAILED");
  }
}
