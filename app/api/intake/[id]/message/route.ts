import { NextResponse } from "next/server";
import { getIntake, updateIntakeDialog } from "@/app/_lib/db/intakes";
import { runIntakeExchange } from "@/app/_lib/intake-run";
import { intakeLang } from "@/app/_lib/intake-lang";
import { stripEndSentinel } from "../../reply-sentinel";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

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
    // Every refusal below carries a CODE (docs/architecture/api-contracts.md
    // §1.1). They were English prose with no code, and the composer collapsed all
    // of them plus the throttle into one "send failed" line: "the session is
    // closed" (re-open it), "type something first" and "slow down" are three
    // different next actions and the reader was told none of them, in any
    // language but English.
    if (!intake) return jsonRefusal("INTAKE_NOT_FOUND", 404);
    if (intake.status !== "open") return jsonRefusal("INTAKE_CLOSED", 409);
    const body = (await request.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
    if (!message) return jsonRefusal("INTAKE_TEXT_REQUIRED", 400);

    // 30/10min holds a human coaching pace. KP_BENCH_MODE=1 raises the budget
    // for the app-master mass-test driver (scripts/app-master-bench) on a LOCAL
    // bench server only — 4 scenarios × 9 scripted turns tripped the human
    // budget and cost a stub sweep ~20 min of throttle waits. Deliberately
    // env-gated at the server, never a client escape hatch; pinned in
    // rate-limit-contract.test.ts (both budgets).
    const benchMode = process.env.KP_BENCH_MODE === "1";
    if (!rateLimit(`intake-message:${clientIpFrom(request.headers)}`, { limit: benchMode ? 600 : 30, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    // The transcript passed to the engine is the history BEFORE this message —
    // the engine fences the new message separately (exactly-once, the devcase
    // chat rule), so it must not also appear in the rendered history.
    const exchange = await runIntakeExchange(
      {
        transcript: intake.transcript,
        brief: intake.brief,
        message,
        lang: intakeLang(intake.lang),
        attachments: intake.attachments,
        // App master: the completed scan grounds every turn. Its presence is what
        // selects the persona overlay and the app-master slot script, so a session
        // whose scan has not landed yet talks like a normal intake until it does.
        dossier: intake.dossier,
      },
      // The requestor's Cancel is a real cancel: a composer left for another tab
      // should not leave a Python process (and a paid completion) running for a
      // screen nobody is watching.
      request.signal
    );

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
    // COMPARE-AND-SWAP, not a blind write. `intake.updatedAt` was read BEFORE the
    // spawn above, which takes as long as a model call; a human brief edit or a
    // spoken turn landing inside that window is already on the row, and writing
    // `exchange.brief` over it would revert a value the requestor STATED. The
    // refusal is the honest outcome — the client re-reads the session rather than
    // painting its own stale copy back over it.
    const write = updateIntakeDialog(
      id,
      {
        transcript,
        brief: exchange.brief,
        shape: exchange.shape,
        ...(briefTitle ? { title: briefTitle } : {}),
        ...(exchange.done ? { status: "complete" as const } : {}),
        expectedUpdatedAt: intake.updatedAt,
      },
      ws
    );
    if (write === "missing") return jsonRefusal("INTAKE_NOT_FOUND", 404);
    if (write === "moved") return jsonRefusal("INTAKE_BRIEF_MOVED", 409);
    return NextResponse.json({
      reply,
      brief: exchange.brief,
      shape: exchange.shape,
      done: exchange.done,
      source: exchange.source,
      ...(exchange.fallbackReason ? { fallbackReason: exchange.fallbackReason } : {}),
    });
  } catch (error) {
    // An aborted request is not a fault: the client is gone, and logging it as a
    // store error would file a deliberate cancel as an incident.
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    return safeJsonError(error, "api:intake/message", "INTAKE_MESSAGE_FAILED");
  }
}
