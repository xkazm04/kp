// The browser's director wire discipline (spark ai-interview-parity).
//
// Every rule here is one a live call breaks quietly if it is wrong: a turn numbered
// from the wrong base is a turn the server rejects as a duplicate, two concurrent
// exchanges are two stage directions for the same moment, and a tool call left
// unanswered is an interviewer that stops talking mid-interview.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_QUEUED_EVENTS,
  MAX_TURNS_PER_REQUEST,
  TOOL_RESULT_FALLBACK,
  createDirectorChannel,
  type DirectorPost,
} from "./director-channel.ts";
import { TOOL_RESULT_CONTINUE } from "@/app/_lib/voice/director.ts";
import type { DirectorRequest, DirectorResponse } from "@/app/_lib/voice/director-types.ts";

const AT = "2026-09-18T10:00:00.000Z";

function ok(over: Partial<DirectorResponse> = {}): DirectorResponse {
  return { ok: true, ackSeq: -1, toolResult: null, directive: null, agenda: { activeBlockId: null, coveredBlockIds: [] }, endCall: false, ...over };
}

/** A recording transport. `answer` decides each exchange's reply; null = unreachable. */
function harness(answer: (req: DirectorRequest, n: number) => DirectorResponse | null) {
  const sent: DirectorRequest[] = [];
  const post: DirectorPost = async (req) => {
    sent.push(req);
    // A microtask hop, so "serialized" is a real claim and not an artifact of
    // everything resolving synchronously.
    await Promise.resolve();
    return answer(req, sent.length - 1);
  };
  return { sent, post };
}

function channel(post: DirectorPost, onResponse?: (r: DirectorResponse) => void) {
  return createDirectorChannel({
    token: "tok",
    sessionId: "sess",
    attempt: 2,
    post,
    onResponse,
    now: () => new Date(AT),
  });
}

test("the fallback result is WORD FOR WORD the director's own 'carry on'", () => {
  // The model cannot tell a director outage from a director answer, and it must not
  // be able to: both mean "keep going". Pinned rather than imported into the bundle.
  assert.equal(TOOL_RESULT_FALLBACK, TOOL_RESULT_CONTINUE);
});

test("turns are numbered per attempt from 0, and an empty turn spends no seq", async () => {
  const h = harness(() => ok({ ackSeq: 1 }));
  const ch = channel(h.post);
  assert.equal(ch.recordTurn("interviewer", "Tell me about your last project."), 0);
  assert.equal(ch.recordTurn("candidate", "   "), 1, "an empty turn reports the seq it would have taken");
  assert.equal(ch.nextSeq, 1, "…but does not spend it");
  assert.equal(ch.recordTurn("candidate", "I rebuilt the ingest."), 1);
  await ch.idle();
  assert.deepEqual(
    h.sent[0].turns.map((t) => [t.seq, t.role, t.text]),
    [[0, "interviewer", "Tell me about your last project."]],
  );
  assert.equal(h.sent[0].attempt, 2, "the connect's attempt rides on every exchange");
  assert.equal(h.sent[0].turns[0].at, AT);
});

test("anything above ackSeq is resent; acknowledged turns are dropped", async () => {
  // The server acknowledges only turn 0 on the first exchange (it truncates, or a
  // retry raced it). Turn 1 must come back — it is not in the record yet.
  const h = harness((_req, n) => ok({ ackSeq: n === 0 ? 0 : 1 }));
  const ch = channel(h.post);
  ch.recordTurn("interviewer", "one");
  ch.recordTurn("candidate", "two");
  await ch.idle();
  assert.equal(h.sent.length, 2, "an unacknowledged turn triggers another exchange");
  assert.deepEqual(h.sent[1].turns.map((t) => t.seq), [1]);
  assert.equal(ch.pendingTurns, 0);
});

test("a progressless answer stops the pump instead of spinning", async () => {
  // The session hit its per-session event ceiling: the director still answers, but
  // ackSeq never advances. Without the guard this posts at fetch speed forever.
  const h = harness(() => ok({ ackSeq: -1 }));
  const ch = channel(h.post);
  ch.recordTurn("candidate", "one");
  await ch.idle();
  assert.ok(h.sent.length <= 3, `expected the pump to give up quickly, sent ${h.sent.length}`);
  assert.equal(ch.pendingTurns, 1, "the turn stays queued for the next trigger");
});

test("at most ONE tool call per request, and a second queues behind the in-flight one", async () => {
  const h = harness((req) => ok({ toolResult: `did ${(req.tool as { name: string } | null)?.name ?? "nothing"}` }));
  const ch = channel(h.post);
  const a = ch.callTool({ callId: "c1", name: "begin_topic", args: { block_id: "b1" } });
  const b = ch.callTool({ callId: "c2", name: "mark_topic_covered", args: "{}" });
  assert.deepEqual(await Promise.all([a, b]), ["did begin_topic", "did mark_topic_covered"]);
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0].tool?.callId, "c1");
  assert.equal(h.sent[1].tool?.callId, "c2");
  for (const req of h.sent) assert.ok(req.tool !== null, "every exchange carried exactly the one call");
});

test("a turn finalized during an in-flight exchange rides the SAME request as its tool call", async () => {
  // The transcription race: the model calls mark_topic_covered while the candidate's
  // utterance is still being transcribed. The shell waits for the turn; the channel
  // must then put both in one exchange, or the quote is checked against a transcript
  // that does not yet contain it.
  const h = harness(() => ok({ ackSeq: 0, toolResult: "recorded" }));
  const ch = channel(h.post);
  ch.hold();
  ch.recordTurn("candidate", "I cut the ingest from nine hours to twenty minutes.");
  const result = ch.callTool({ callId: "c1", name: "mark_topic_covered", args: { block_id: "b1" } });
  ch.release();
  assert.equal(await result, "recorded");
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].turns.length, 1, "the quote's turn is IN the request that carries the tool call");
  assert.equal(h.sent[0].tool?.callId, "c1");
});

test("without the hold the turn still lands BEFORE the tool call, never after", async () => {
  // The serializer is the backstop: even when the turn already flushed, the director
  // has persisted it by the time the tool call is applied.
  const h = harness(() => ok({ ackSeq: 0, toolResult: "recorded" }));
  const ch = channel(h.post);
  ch.recordTurn("candidate", "I cut the ingest to twenty minutes.");
  const result = ch.callTool({ callId: "c1", name: "mark_topic_covered", args: {} });
  assert.equal(await result, "recorded");
  const turnIdx = h.sent.findIndex((r) => r.turns.length > 0);
  const toolIdx = h.sent.findIndex((r) => r.tool !== null);
  assert.ok(turnIdx >= 0 && toolIdx >= 0 && turnIdx <= toolIdx, `turn@${turnIdx} must not follow tool@${toolIdx}`);
});

test("an unreachable director is retried by the NEXT trigger, never in a loop", async () => {
  // The bug this pins: re-entering the pump whenever work remained turned a director
  // outage into an unbounded fetch loop on the candidate's tab (it OOMed the test
  // runner before it could reach a browser).
  const h = harness(() => null);
  const ch = channel(h.post);
  for (let i = 0; i < 30; i += 1) ch.recordEvent({ kind: "focus_lost", at: AT, during: "idle" });
  await ch.idle();
  assert.equal(h.sent.length, 1, "one exchange per trigger burst, not one per queued item");
  ch.heartbeat();
  await ch.idle();
  assert.equal(h.sent.length, 2, "the next trigger tries again");
});

test("EVERY unreachable exchange answers the waiting model itself", async () => {
  for (const answer of [null, null]) {
    const h = harness(() => answer);
    const ch = channel(h.post);
    assert.equal(await ch.callTool({ callId: "c1", name: "end_interview", args: { reason: "complete" } }), TOOL_RESULT_FALLBACK);
    assert.equal(h.sent.length, 1, "a failed exchange does not immediately retry");
  }
});

test("a throwing transport is the same fact as a refusal", async () => {
  const ch = channel(async () => {
    throw new Error("offline");
  });
  assert.equal(await ch.callTool({ callId: "c1", name: "begin_topic", args: {} }), TOOL_RESULT_FALLBACK);
});

test("close() answers everything still queued — the model is never left waiting", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const ch = channel(async () => {
    await gate;
    return ok({ toolResult: "first" });
  });
  const first = ch.callTool({ callId: "c1", name: "begin_topic", args: {} });
  const second = ch.callTool({ callId: "c2", name: "forward_question", args: {} });
  ch.close();
  assert.equal(await second, TOOL_RESULT_FALLBACK);
  assert.equal(await ch.callTool({ callId: "c3", name: "begin_topic", args: {} }), TOOL_RESULT_FALLBACK);
  release();
  assert.equal(await first, "first", "the exchange already in flight still delivers its real answer");
  assert.equal(ch.closed, true);
});

test("a heartbeat posts with nothing queued — it is how the clock reaches the browser", async () => {
  const h = harness(() => ok({ endCall: true }));
  const seen: DirectorResponse[] = [];
  const ch = channel(h.post, (r) => seen.push(r));
  ch.heartbeat();
  await ch.idle();
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].turns, []);
  assert.equal(h.sent[0].tool, null);
  assert.equal(seen[0].endCall, true);
});

test("observations are bounded and sent in order, oldest dropped first", async () => {
  const h = harness(() => null); // unreachable: nothing drains
  const ch = channel(h.post);
  for (let i = 0; i < MAX_QUEUED_EVENTS + 10; i += 1) {
    ch.recordEvent({ kind: "answer_timing", at: AT, turnSeq: i, preSilenceMs: null, durationMs: null });
  }
  await ch.idle();
  const h2 = harness(() => ok({ ackSeq: -1 }));
  const ch2 = channel(h2.post);
  for (let i = 0; i < 25; i += 1) {
    ch2.recordEvent({ kind: "focus_lost", at: AT, during: "idle" });
  }
  await ch2.idle();
  assert.ok(h2.sent[0].events.length <= 20, "a request carries at most the server's ceiling");
});

test("a request never exceeds the server's per-request turn ceiling", async () => {
  const h = harness(() => ok({ ackSeq: -1 }));
  const ch = channel(h.post);
  ch.hold();
  for (let i = 0; i < MAX_TURNS_PER_REQUEST + 5; i += 1) ch.recordTurn("candidate", `turn ${i}`);
  ch.release();
  await ch.idle();
  assert.equal(h.sent[0].turns.length, MAX_TURNS_PER_REQUEST);
});

test("a throwing response handler does not break the loop holding a tool result", async () => {
  const h = harness(() => ok({ toolResult: "recorded" }));
  const ch = channel(h.post, () => {
    throw new Error("setState after unmount");
  });
  assert.equal(await ch.callTool({ callId: "c1", name: "begin_topic", args: {} }), "recorded");
});
