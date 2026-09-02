import { NextResponse } from "next/server";
import { appendDevSessionChat, appendDevSessionEvents, getDevCase, getDevSessionChat, getDevSessionMeta, getPostingByToken, lifecycleByPosting } from "@/app/_lib/db/devcase";
import { runSessionChat } from "@/app/_lib/devcase-run";
import { jsonError, jsonRefusal } from "@/app/_lib/api-response";
import { rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { sessionTokenMatches } from "@/app/_lib/devcase-session-auth";

// LLM-era controls #2/#5 — the captured prompt channel. The candidate's assistant
// and stakeholder chats flow THROUGH the platform: every user message and model
// reply is persisted (dev_session_chat) and a chained "prompt" event marks the
// exchange in the observed process log. That makes the human<->LLM dialogue —
// how they decompose, iterate, verify, and what they ask the stakeholder —
// first-class evaluation evidence rather than something inferred from artifacts.
// Payload is candidate-controlled: coerce hard, cap sizes; the Python side fences
// the transcript as untrusted data.

const MAX_MESSAGE_CHARS = 4_000;

// THROTTLE (rate-limit-contract.test.ts). Every request here is a real, paid LLM call on
// a PUBLIC route. The only prior bounds were 400 messages/session and 50 sessions/token/day
// — a ceiling of ~20,000 unauthenticated model calls per leaked apply link per day. Two
// windows, both keyed by things an abuser cannot rotate (never the caller's IP: candidates
// legitimately share a NAT, and IP-throttling an assessment surface punishes the honest case).
//
//  1. Per SESSION, 30/10min — one candidate's pace. An exchange costs a 3-10s generation,
//     reading a paragraph of reply, and typing a follow-up; the fastest honest loop is
//     roughly one message per 40-60s. 30 per 10 minutes is one per 20s — ~2-3x the fastest
//     real pace, so a candidate never meets it, while a scripted loop is pinned to 3/min
//     instead of unbounded.
//  2. Per TOKEN, 3000/24h — the aggregate for the apply link. NOTE the difference from
//     `interview-connect`, whose token is per-candidate: a dev-case token is per-POSTING and
//     shared by every applicant, so this budget is collective. Session-start already caps a
//     posting at 50 sessions/day, so 3,000 leaves 60 chat messages per session at full
//     quota — far more dialogue than a timeboxed case produces — while cutting the abuse
//     ceiling from ~20,000 model calls/token/day to 3,000.
//
// Both refusals are the shared 429 envelope, and the client renders a distinct
// "you've reached the limit" line (devApply.workSurface.chatRateLimited) — an exhausted
// budget must read as a stated limit, never as a failure that looks like lost work.

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
      token?: unknown;
    };
    // A session id alone is not authority to spend this session's model budget —
    // the caller must present the apply token that minted it (devcase-session-auth.ts).
    //
    // A TOKENLESS session (fixtures/dev seeds; the public mint always carries one) used to
    // take a `session.token && …` carve-out here and walk past BOTH this gate and the
    // per-token daily budget below — an unauthenticated caller holding such an id had an
    // unmetered LLM door. The submit sibling already refused those outright; chat and the
    // flush now agree, so one rule covers all three mutating doors.
    if (!session.token || !sessionTokenMatches(session.token, body.token)) {
      return jsonRefusal("SESSION_TOKEN_REQUIRED", 403);
    }
    const channel = body.channel === "stakeholder" ? "stakeholder" : "assistant";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
    if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });
    const cf = body.currentFile as { path?: unknown; contents?: unknown } | null | undefined;
    const currentFile =
      channel === "assistant" && cf && typeof cf.path === "string" && typeof cf.contents === "string"
        ? { path: cf.path, contents: cf.contents.slice(0, 64_000) }
        : null;

    // Throttle AFTER the lifecycle/authorization/validation refusals (so a rejected call
    // never consumes budget) and BEFORE any DB write or the model call, so a refused
    // request also can't eat into the 400-message session ceiling.
    if (!rateLimit(`devcase-chat:${id}`, { limit: 30, windowMs: 10 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    if (session.token && !rateLimit(`devcase-chat-token:${session.token}`, { limit: 3000, windowMs: 24 * 60 * 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }

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
    //
    // `request.signal` is forwarded: the abort reaches spawnPython (the kp
    // SIGKILL-on-abort convention), so a candidate who navigates away or whose
    // connection drops mid-generation does not leave a Python child running for the
    // remainder of its timeout. `runSessionChat` has always accepted the signal; this
    // route was the one caller that never passed one.
    const { reply, source } = await runSessionChat(
      channel,
      (devCase.case as Record<string, unknown>) ?? {},
      (devCase.role as Record<string, unknown>) ?? {},
      transcript,
      message,
      currentFile,
      lang,
      request.signal
    );
    if (reply) appendDevSessionChat(id, channel, "model", reply);
    // `source` ("llm" | "deterministic") rides the response so the candidate can tell a
    // real stakeholder/assistant reply from the keyless deterministic stub. Degrading
    // without keys is a product property here; presenting the stub as if a model had
    // answered is the dishonest half, and the candidate is the person whose next hour of
    // work depends on knowing which one they are talking to.
    return NextResponse.json({ reply, source });
  } catch (error) {
    return jsonError(error, "Failed to reach the chat channel.");
  }
}
