import { NextRequest, NextResponse } from "next/server";
import { getIntake, updateIntakeDialog } from "@/app/_lib/db/intakes";
import { runIntakeTranscriptExtract } from "@/app/_lib/intake-run";
import { capTranscriptTurns, clampTurn } from "@/app/_lib/interview-transcript";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { safeJsonError } from "@/app/_lib/api-response";

// POST /api/intake/[id]/voice-complete — the hang-up half of the intake voice
// plane: the browser posts the accumulated VoiceTurn[] transcript, the server
// appends it to the dialog and runs ONE batch extraction over it
// (pipeline/jobfit/intake.py::extract_transcript — merge-protected like every
// text exchange). Keyless the extraction honestly declines (extracted: false):
// the transcript is preserved, the brief is untouched, and the requestor
// continues in text. The session NEVER closes here — voice is an input mode,
// the read-back/confirm contract stays with the text plane.

const MAX_VOICE_TURNS = 400;

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
    const body = (await request.json().catch(() => ({}))) as { turns?: unknown };
    const rawTurns = Array.isArray(body.turns) ? body.turns.slice(0, MAX_VOICE_TURNS) : [];
    // Same trust-boundary clamps as the interview /complete route: per-turn
    // role/text/at coercion, then the global cap with honest drop accounting.
    const clamped = rawTurns
      .map((t) => clampTurn((t ?? {}) as { role?: unknown; text: unknown; at?: unknown }).turn)
      .filter((t) => t.text.trim().length > 0);
    if (clamped.length === 0) {
      return NextResponse.json({ error: "turns are required" }, { status: 400 });
    }
    const { turns } = capTranscriptTurns(clamped);

    // THROTTLE (rate-limit-contract.test.ts): each accepted hang-up runs one
    // paid batch extraction. 6/10min per IP — a human records at most a couple
    // of voice sessions in a sitting; a scripted loop is pinned. After the
    // cheap refusals, before the DB write + model call.
    if (!rateLimit(`intake-voice-complete:${clientIpFrom(request.headers)}`, { limit: 6, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }

    const lang = intake.lang === "cs" ? "cs" : "en";
    const result = await runIntakeTranscriptExtract({ transcript: turns, brief: intake.brief, lang });

    const transcript = [...intake.transcript, ...turns];
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
