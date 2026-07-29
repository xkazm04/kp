import { NextResponse } from "next/server";
import {
  appendDevSessionChat,
  appendDevSessionEvents,
  getDevCase,
  getDevSessionChat,
  getDevSessionMeta,
  getPostingByToken,
  lifecycleByPosting,
} from "@/app/_lib/db";
import { runSessionChat } from "@/app/_lib/devcase-run";
import { jsonError } from "@/app/_lib/api-response";

// LLM-era controls #2/#5 — the captured prompt channel. The candidate's assistant
// and stakeholder chats flow THROUGH the platform: every user message and model
// reply is persisted (dev_session_chat) and a chained "prompt" event marks the
// exchange in the observed process log. That makes the human<->LLM dialogue —
// how they decompose, iterate, verify, and what they ask the stakeholder —
// first-class evaluation evidence rather than something inferred from artifacts.
// Payload is candidate-controlled: coerce hard, cap sizes; the Python side fences
// the transcript as untrusted data.

const MAX_MESSAGE_CHARS = 4_000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // Status-only read (case-sim round 3): this route branches on status/token only.
    const session = getDevSessionMeta(id);
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    if (session.status !== "active") return NextResponse.json({ error: "session already submitted" }, { status: 409 });

    const body = (await request.json().catch(() => ({}))) as {
      channel?: unknown;
      message?: unknown;
      currentFile?: unknown;
    };
    const channel = body.channel === "stakeholder" ? "stakeholder" : "assistant";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
    if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });
    const cf = body.currentFile as { path?: unknown; contents?: unknown } | null | undefined;
    const currentFile =
      channel === "assistant" && cf && typeof cf.path === "string" && typeof cf.contents === "string"
        ? { path: cf.path, contents: cf.contents.slice(0, 64_000) }
        : null;

    const posting = session.token ? getPostingByToken(session.token) : null;
    const devCase = posting?.caseId ? getDevCase(posting.caseId) : null;
    if (!devCase?.case) return NextResponse.json({ error: "case unavailable" }, { status: 404 });

    // Transcript BEFORE this message (channel-scoped) is the model's continuity
    // context; the stored copy is the evaluation evidence.
    const transcript = getDevSessionChat(id, channel).map((m) => ({ channel: m.channel, role: m.role, text: m.text }));
    const stored = appendDevSessionChat(id, channel, "user", message);
    if (stored === 0) return NextResponse.json({ error: "chat limit reached for this session" }, { status: 429 });
    // Server-recorded, chained process event: one captured exchange on this channel.
    appendDevSessionEvents(id, [{ t: Date.now(), kind: "prompt", path: channel, size: message.length }]);

    const lang = posting ? lifecycleByPosting(posting.id)?.lang : null;
    // Exactly ONE copy of the new message reaches the model: chat.py fences it
    // separately as CANDIDATE_MESSAGE, so the transcript passed here is the
    // history BEFORE this message. Re-appending it (case-sim round 3 canary c1)
    // doubled the newest message in the model context on every exchange.
    const { reply } = await runSessionChat(
      channel,
      (devCase.case as Record<string, unknown>) ?? {},
      (devCase.role as Record<string, unknown>) ?? {},
      transcript,
      message,
      currentFile,
      lang
    );
    if (reply) appendDevSessionChat(id, channel, "model", reply);
    return NextResponse.json({ reply });
  } catch (error) {
    return jsonError(error, "Failed to reach the chat channel.");
  }
}
