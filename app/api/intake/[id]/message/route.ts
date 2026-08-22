import { NextResponse } from "next/server";
import { getIntake, updateIntakeDialog } from "@/app/_lib/db/intakes";
import { runIntakeExchange } from "@/app/_lib/intake-run";
import { stripEndSentinel } from "../../reply-sentinel";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { safeJsonError } from "@/app/_lib/api-response";

const MAX_MESSAGE_CHARS = 4_000;

// POST /api/intake/[id]/message — one dialog exchange: the requestor's message
// in, the agent's reply + re-extracted RoleBrief out (persisted atomically).
//
// THROTTLE (rate-limit-contract.test.ts): every accepted message is a real,
// potentially-paid LLM call. The route is operator-gated, but in open mode
// (no KP_OPERATOR_PASSWORD) the whole API is open, so it must self-limit like
// /api/analyze: per-IP, 30/10min — a coaching-paced human exchange (read a
// reflection, think, type) runs well under one message per 20s, while a
// scripted loop is pinned. Runs AFTER the cheap refusals (404/409/400) so a
// rejected call never consumes budget, and BEFORE the DB write + model call.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
    if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

    if (!rateLimit(`intake-message:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }

    // The transcript passed to the engine is the history BEFORE this message —
    // the engine fences the new message separately (exactly-once, the devcase
    // chat rule), so it must not also appear in the rendered history.
    const exchange = await runIntakeExchange({
      transcript: intake.transcript,
      brief: intake.brief,
      message,
      lang: intake.lang === "cs" ? "cs" : "en",
      attachments: intake.attachments,
    });

    // Recertify R-2: the <<END>> sentinel is an engine/eval wire contract, not
    // copy — strip it at the route boundary so it never reaches the stored
    // transcript or the requestor's screen. Shared with /voice-turn, which
    // needs the same strip for a stronger reason (the transport SPEAKS the
    // reply verbatim) — reply-sentinel.ts.
    const reply = stripEndSentinel(exchange.reply);
    const now = new Date().toISOString();
    const transcript = [
      ...intake.transcript,
      { role: "candidate" as const, text: message, at: now },
      { role: "interviewer" as const, text: reply, at: now },
    ];
    // The brief's evolving title becomes the session title (first write wins
    // via COALESCE only when non-empty — a later rename by the engine sticks).
    const briefTitle = typeof exchange.brief?.title === "string" ? exchange.brief.title : "";
    updateIntakeDialog(
      id,
      {
        transcript,
        brief: exchange.brief,
        shape: exchange.shape,
        ...(briefTitle ? { title: briefTitle } : {}),
        ...(exchange.done ? { status: "complete" as const } : {}),
      },
      ws
    );
    return NextResponse.json({
      reply,
      brief: exchange.brief,
      shape: exchange.shape,
      done: exchange.done,
      source: exchange.source,
      ...(exchange.fallbackReason ? { fallbackReason: exchange.fallbackReason } : {}),
    });
  } catch (error) {
    return safeJsonError(error, "api:intake/message", "INTAKE_MESSAGE_FAILED");
  }
}
