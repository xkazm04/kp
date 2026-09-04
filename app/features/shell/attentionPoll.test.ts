import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTENTION_POLL_MS,
  ATTENTION_BACKOFF_BASE_MS,
  ATTENTION_BACKOFF_MAX_MS,
  attentionPollDelayMs,
  shouldPollNow,
} from "./attentionPoll.ts";
import { POLL_BACKOFF_BASE_MS, POLL_BACKOFF_MAX_MS } from "@/app/_lib/task-poll-state.ts";

// The badge poll re-armed at a FLAT 60s regardless of whether the last read reached
// the server: against a restarting server, a laptop off the network or a 500 loop
// that is one request a minute for ever, from every open tab, for a hint. It now
// rides the SAME curve the tasks dock uses (task-poll-state.ts) — the two polls
// disagreeing about how to treat a dead endpoint was the accident.

test("healthy: the plain 60s heartbeat", () => {
  assert.equal(attentionPollDelayMs(0), ATTENTION_POLL_MS);
  assert.equal(ATTENTION_POLL_MS, 60_000);
});

test("the backoff curve is the tasks dock's, scaled off the same base", () => {
  assert.equal(ATTENTION_BACKOFF_BASE_MS, POLL_BACKOFF_BASE_MS * 15); // 60s, one heartbeat
  assert.equal(ATTENTION_BACKOFF_MAX_MS, POLL_BACKOFF_MAX_MS * 10); // 10 min ceiling
});

test("failures double the wait: 60s, 2m, 4m, 8m, then the ceiling for ever", () => {
  assert.equal(attentionPollDelayMs(1), 60_000);
  assert.equal(attentionPollDelayMs(2), 120_000);
  assert.equal(attentionPollDelayMs(3), 240_000);
  assert.equal(attentionPollDelayMs(4), 480_000);
  assert.equal(attentionPollDelayMs(5), ATTENTION_BACKOFF_MAX_MS);
});

test("the exponent is clamped — no Infinity after a long outage", () => {
  assert.equal(attentionPollDelayMs(2000), ATTENTION_BACKOFF_MAX_MS);
  assert.ok(Number.isFinite(attentionPollDelayMs(2000)));
});

test("one success resets the schedule", () => {
  assert.equal(attentionPollDelayMs(0), ATTENTION_POLL_MS);
});

// A hidden tab must not spend requests; coming BACK is the moment a stale badge is
// most visibly wrong, so the return is a read, not a wait for the next tick.
test("a hidden document never polls", () => {
  assert.equal(shouldPollNow(true), false);
  assert.equal(shouldPollNow(false), true);
});
