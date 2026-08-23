import { NextResponse } from "next/server";
import { appendTurn, getThread, listTurns, renameThread } from "@/app/_lib/db/companion";
import { runCompanionTurn } from "@/app/_lib/companion-run";
import { clampCompanionMessage, deriveThreadTitle } from "@/app/_lib/companion-turn";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { getServerLocale } from "@/i18n/server";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { safeJsonError } from "@/app/_lib/api-response";

// POST /api/companion/[id]/message — one companion exchange: the operator's
// message in, Candi's reply out, both persisted (docs/features/companion/README.md).
//
// THROTTLE (rate-limit-contract.test.ts): every accepted message spawns Python
// AND makes a potentially-paid `assistant` call. The route is operator-gated,
// but in open mode (no KP_OPERATOR_PASSWORD) the whole API is open, so it must
// self-limit like /api/intake/[id]/message: per-IP, 30/10min — an operator
// asking their studio a question runs far under that, a scripted loop is pinned.
// Runs AFTER the cheap refusals (404/400) so a rejected call never consumes
// budget, and BEFORE the DB write + the spawn.
//
// WRITE ORDER — the operator's words land FIRST, before the model is called.
// That mirrors the brain's own contract (companion_cli.py appends the user
// episode before completing), and it is the reason a provider timeout costs a
// reply but never the question. A spawn failure therefore leaves a user turn
// with no answer: that is the honest record, not a bug — the transcript shows
// exactly what happened.
//
// The response carries the thread's FULL turn list rather than just the new
// pair, so the client replaces its optimistic bubbles with server truth on every
// exchange. The dock coalesces messages typed while a turn is in flight (the
// shared voiceOrchestration machine), so one POST can answer two typed bubbles —
// reconciling against the stored list is what keeps the screen honest about it.

const MAX_MESSAGE_CHARS = 4_000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const thread = getThread(id, ws);
    if (!thread) return NextResponse.json({ error: "Companion thread not found." }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { message?: unknown };
    const message = clampCompanionMessage(body.message).slice(0, MAX_MESSAGE_CHARS);
    if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

    if (!rateLimit(`companion-message:${clientIpFrom(request.headers)}`, { limit: 30, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }

    // The transcript handed to the engine is the history BEFORE this message —
    // the CLI fences the new message separately, so it must not also appear in
    // the rendered history.
    const history = listTurns(id, ws);
    appendTurn({ threadId: id, role: "user", content: message }, ws);
    if (!thread.title.trim()) renameThread(id, deriveThreadTitle(message), ws);

    const turn = await runCompanionTurn({
      workspaceId: ws,
      threadId: id,
      message,
      transcript: history.map((t) => ({ role: t.role, content: t.content })),
      locale: await getServerLocale(),
    });

    appendTurn(
      {
        threadId: id,
        role: "assistant",
        content: turn.reply,
        meta: {
          source: turn.source,
          recallUsed: turn.recallUsed,
          episodePaths: turn.episodePaths,
          indexSkipped: turn.indexSkipped,
          ...(turn.fallbackReason ? { fallbackReason: turn.fallbackReason } : {}),
        },
      },
      ws
    );

    return NextResponse.json({
      turns: listTurns(id, ws),
      source: turn.source,
      ...(turn.fallbackReason ? { fallbackReason: turn.fallbackReason } : {}),
    });
  } catch (error) {
    return safeJsonError(error, "api:companion/message", "COMPANION_MESSAGE_FAILED");
  }
}
