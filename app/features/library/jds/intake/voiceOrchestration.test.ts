// The client half of the two-thread voice design — serialization, coalescing,
// and the periodic-extraction cadence (voice-conversation-plane.md). Pure.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXTRACT_EVERY,
  completeTurn,
  enqueueUtterance,
  initialOrchestratorState,
  spokenOpener,
} from "./voiceOrchestration.ts";

test("an utterance dispatches immediately when idle and queues while busy", () => {
  const a = enqueueUtterance(initialOrchestratorState, "first thought");
  assert.equal(a.dispatch, "first thought");
  assert.equal(a.state.busy, true);
  const b = enqueueUtterance(a.state, "second thought");
  assert.equal(b.dispatch, null);
  assert.deepEqual(b.state.queue, ["second thought"]);
});

test("queued utterances coalesce into ONE follow-up dispatch", () => {
  let s = enqueueUtterance(initialOrchestratorState, "one").state;
  s = enqueueUtterance(s, "two").state;
  s = enqueueUtterance(s, "three").state;
  const done = completeTurn(s, false);
  assert.equal(done.next, "two three");
  assert.equal(done.state.busy, true);
  assert.deepEqual(done.state.queue, []);
});

test("the extraction sweep fires every EXTRACT_EVERY exchanges and at the close", () => {
  let s = enqueueUtterance(initialOrchestratorState, "a").state;
  const first = completeTurn(s, false);
  assert.equal(first.extract, (EXTRACT_EVERY as number) === 1);
  s = enqueueUtterance(first.state, "b").state;
  const second = completeTurn(s, false);
  assert.equal(second.extract, true); // exchange #2 with EXTRACT_EVERY=2
  s = enqueueUtterance(second.state, "c").state;
  const closed = completeTurn(s, true);
  assert.equal(closed.extract, true); // the close always sweeps
  assert.equal(closed.state.ended, true);
});

test("after the engine closes, further utterances are dropped and nothing dispatches", () => {
  let s = enqueueUtterance(initialOrchestratorState, "a").state;
  s = enqueueUtterance(s, "still talking").state; // queued behind the in-flight turn
  const closed = completeTurn(s, true);
  assert.equal(closed.next, null); // queued speech is NOT dispatched after a close
  const after = enqueueUtterance(closed.state, "hello?");
  assert.equal(after.dispatch, null);
});

test("empty/whitespace utterances never dispatch", () => {
  const r = enqueueUtterance(initialOrchestratorState, "   ");
  assert.equal(r.dispatch, null);
  assert.equal(r.state.busy, false);
});

test("spokenOpener continues the pending question from the text thread", () => {
  const transcript = [
    { role: "interviewer", text: "Where did the team feel it most?" },
    { role: "candidate", text: "Backfill" },
    { role: "interviewer", text: "What should be done in 90 days?" },
  ];
  assert.equal(spokenOpener(transcript), "What should be done in 90 days?");
  assert.equal(spokenOpener([]), null);
});
