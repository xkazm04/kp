// The tasks dock's poll reducer + schedule. Before this file TasksProvider had no
// test of any kind: the signature bail-out (the reason the whole workspace does not
// re-render every 2s), the loadFailed third state, and the re-arm delay were all
// unverified behaviour inside a .tsx the node runner cannot load.
//
// Runner: node:test, via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  POLL_ACTIVE_MS,
  POLL_BACKOFF_MAX_MS,
  POLL_IDLE_MS,
  RESULT_FETCH_MAX_ATTEMPTS,
  initialTasksPollState,
  nextResultFetchAttempts,
  pollDelayMs,
  resultFetchGaveUp,
  queueUnreachable,
  tasksPollReducer,
} from "./task-poll-state.ts";
import type { TaskSignatureRow } from "./task-view.ts";

function row(over: Partial<TaskSignatureRow> = {}): TaskSignatureRow {
  return {
    id: "t1",
    status: "running",
    progressDone: 0,
    progressTotal: 0,
    progressMsg: null,
    label: "Analyze · CV",
    error: null,
    startedAt: null,
    finishedAt: null,
    seenAt: null,
    ...over,
  };
}

test("an unchanged healthy poll is a no-op down to the object identity", () => {
  const start = tasksPollReducer(initialTasksPollState<TaskSignatureRow>(), { type: "polled", tasks: [row()] });
  // A FRESH array with identical contents — exactly what `await r.json()` hands back.
  const again = tasksPollReducer(start, { type: "polled", tasks: [row()] });
  assert.equal(again, start, "the same state object, or every consumer re-renders on every tick");
});

test("a changed poll commits the new rows", () => {
  const start = tasksPollReducer(initialTasksPollState<TaskSignatureRow>(), { type: "polled", tasks: [row()] });
  const next = tasksPollReducer(start, { type: "polled", tasks: [row({ status: "succeeded", finishedAt: "2026-09-03T00:00:00Z" })] });
  assert.notEqual(next, start);
  assert.equal(next.tasks[0].status, "succeeded");
});

test("a failed poll keeps the last good rows and counts the failure", () => {
  const loaded = tasksPollReducer(initialTasksPollState<TaskSignatureRow>(), { type: "polled", tasks: [row()] });
  const failed = tasksPollReducer(loaded, { type: "pollFailed" });
  assert.equal(failed.loadFailed, true);
  assert.equal(failed.failures, 1);
  assert.equal(failed.tasks, loaded.tasks, "a dropped fetch must not blank the list");
  const twice = tasksPollReducer(failed, { type: "pollFailed" });
  assert.equal(twice.failures, 2);
  // Recovery clears both, and — the subtle part — still keeps the array reference
  // when the rows themselves did not move.
  const back = tasksPollReducer(twice, { type: "polled", tasks: [row()] });
  assert.equal(back.loadFailed, false);
  assert.equal(back.failures, 0);
  assert.equal(back.tasks, loaded.tasks, "unchanged rows keep their reference across a recovery");
});

test("action errors are held and cleared, and a clear on empty is a no-op", () => {
  const s0 = initialTasksPollState<TaskSignatureRow>();
  assert.equal(tasksPollReducer(s0, { type: "clearError" }), s0);
  const errored = tasksPollReducer(s0, { type: "actionFailed", kind: "retry", message: "Too many requests." });
  assert.deepEqual(errored.startError, { kind: "retry", message: "Too many requests." });
  assert.equal(tasksPollReducer(errored, { type: "actionOk" }).startError, null);
  assert.equal(tasksPollReducer(errored, { type: "clearError" }).startError, null);
  // A failure must not disturb the rows, and a poll must not clear the error banner.
  const withRows = tasksPollReducer(errored, { type: "polled", tasks: [row()] });
  assert.deepEqual(withRows.startError, errored.startError);
});

test("the poll backs off on failure and recovers immediately on success", () => {
  assert.equal(pollDelayMs(true, 0), POLL_ACTIVE_MS);
  assert.equal(pollDelayMs(false, 0), POLL_IDLE_MS);
  // The stated curve: 4s, 8s, 16s, 32s, then the 60s ceiling for ever.
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => pollDelayMs(true, n)), [4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  // An absurd failure count cannot overflow past the cap.
  assert.equal(pollDelayMs(true, 5_000), POLL_BACKOFF_MAX_MS);
  // Backoff ignores activity: a running task does not entitle a dead endpoint to
  // 30 requests a minute.
  assert.equal(pollDelayMs(false, 3), pollDelayMs(true, 3));
});

test("the queue is called unreachable only after a second consecutive failure", () => {
  assert.equal(queueUnreachable({ failures: 0 }), false);
  assert.equal(queueUnreachable({ failures: 1 }), false, "one dropped request is noise, not an outage");
  assert.equal(queueUnreachable({ failures: 2 }), true);
});

test("the full-record fetch gives up after a bounded run of failures", () => {
  // The counter is about CONSECUTIVE failures: one success resets it, so a flaky
  // connection never accumulates its way to a permanent "result unavailable".
  let attempts = 0;
  for (let i = 0; i < RESULT_FETCH_MAX_ATTEMPTS - 1; i++) {
    attempts = nextResultFetchAttempts(attempts, false);
    assert.equal(resultFetchGaveUp(attempts), false, `gave up after ${attempts} of ${RESULT_FETCH_MAX_ATTEMPTS}`);
  }
  attempts = nextResultFetchAttempts(attempts, false);
  assert.equal(attempts, RESULT_FETCH_MAX_ATTEMPTS);
  assert.equal(resultFetchGaveUp(attempts), true, "past the ceiling the spinner MUST resolve into an error");
  assert.equal(nextResultFetchAttempts(attempts, true), 0, "a success resets the run");
  assert.equal(resultFetchGaveUp(0), false);
});
