// The backgrounded-build poll schedule. Pinned because both readers of an
// "analyzing" JD share it and the failure it exists to prevent is silent: a
// detached jd_build handler that dies leaves the row "analyzing" forever, and the
// old setInterval polled that dead row for as long as the tab stayed open.
import test from "node:test";
import assert from "node:assert/strict";
import { nextPollDelay, pollExhausted, POLL_BASE_MS, POLL_MAX_DURATION_MS, POLL_MAX_MS } from "./jdsBuildPoll.ts";

test("the first tick is fast, then the delay doubles to the cap", () => {
  assert.equal(nextPollDelay(0), POLL_BASE_MS);
  assert.equal(nextPollDelay(1), POLL_BASE_MS * 2);
  assert.equal(nextPollDelay(2), POLL_BASE_MS * 4);
  assert.equal(nextPollDelay(3), POLL_MAX_MS);
  assert.equal(nextPollDelay(50), POLL_MAX_MS);
});

test("a negative or non-count attempt still yields the base delay", () => {
  assert.equal(nextPollDelay(-1), POLL_BASE_MS);
});

test("backoff is bounded above AND below — never faster than the base tick", () => {
  for (let i = 0; i < 12; i += 1) {
    const d = nextPollDelay(i);
    assert.ok(d >= POLL_BASE_MS, `attempt ${i} polled faster than the base tick`);
    assert.ok(d <= POLL_MAX_MS, `attempt ${i} exceeded the cap`);
  }
});

test("a poll session expires exactly at the max duration, not before", () => {
  const start = 1_000_000;
  assert.equal(pollExhausted(start, start), false);
  assert.equal(pollExhausted(start, start + POLL_MAX_DURATION_MS - 1), false);
  assert.equal(pollExhausted(start, start + POLL_MAX_DURATION_MS), true);
  assert.equal(pollExhausted(start, start + POLL_MAX_DURATION_MS * 3), true);
});

test("the max duration comfortably outlasts a normal build", () => {
  // runJdBuild is a 1-2 minute AI chain; the ceiling must not cut a healthy build
  // short and call it stalled.
  assert.ok(POLL_MAX_DURATION_MS >= 5 * 60 * 1000);
});
