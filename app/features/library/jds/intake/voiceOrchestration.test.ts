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

test("a FAILED turn's utterance is kept, not dropped — and rides out with the next one", () => {
  // The requestor states a dealbreaker; its /voice-turn POST fails (429, blip).
  // Only DELIVERED utterances are persisted server-side, so if the orchestrator
  // forgets it here the sentence exists in no transcript and no brief.
  const spoken = enqueueUtterance(initialOrchestratorState, "the dealbreaker is a security clearance");
  assert.equal(spoken.dispatch, "the dealbreaker is a security clearance");
  const failed = completeTurn(spoken.state, false, "the dealbreaker is a security clearance");
  assert.equal(failed.next, null); // never an automatic retry against a paid endpoint
  assert.deepEqual(failed.state.queue, ["the dealbreaker is a security clearance"]);
  assert.equal(failed.state.busy, false);
  // They keep talking: the lost words go out WITH the next utterance, in order.
  const resumed = enqueueUtterance(failed.state, "and they must speak Czech");
  assert.equal(resumed.dispatch, "the dealbreaker is a security clearance and they must speak Czech");
  assert.deepEqual(resumed.state.queue, []);
});

test("a close keeps unsent speech for the hang-up recovery instead of erasing it", () => {
  // Utterances still queued when the engine closes can no longer be dispatched,
  // but finish() posts the queue to /voice-complete — clearing it here made the
  // component's documented recovery path read an empty queue every time.
  let s = enqueueUtterance(initialOrchestratorState, "a").state;
  s = enqueueUtterance(s, "one last thing — it must be someone with clearance").state;
  const closed = completeTurn(s, true);
  assert.equal(closed.next, null);
  assert.deepEqual(closed.state.queue, ["one last thing — it must be someone with clearance"]);
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
