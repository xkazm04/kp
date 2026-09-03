// The Schedule tab's live-status poll cadence (/perfect 2026-09-03, schedule-ui-2).
// The curve is a stated contract — a doubling backoff with a hard 60s ceiling — so it
// is pinned rather than left to a magic number inside a hook.
import { test } from "node:test";
import assert from "node:assert/strict";
import { POLL_BASE_MS, POLL_MAX_MS, pollDelayMs, pollIsStale } from "./schedulePollBackoff.ts";

test("a healthy poll keeps the 6s cadence", () => {
  assert.equal(pollDelayMs(0), POLL_BASE_MS);
  assert.equal(POLL_BASE_MS, 6_000);
});

test("consecutive failures double the delay: 12s, 24s, 48s", () => {
  assert.equal(pollDelayMs(1), 12_000);
  assert.equal(pollDelayMs(2), 24_000);
  assert.equal(pollDelayMs(3), 48_000);
});

test("the curve CAPS at 60s and never stops retrying", () => {
  // Deliberate: an uncapped exponential eventually stops polling altogether, and a
  // recruiter whose network came back would have to reload the page to be picked up.
  assert.equal(pollDelayMs(4), POLL_MAX_MS);
  assert.equal(pollDelayMs(50), POLL_MAX_MS);
  assert.equal(POLL_MAX_MS, 60_000);
});

test("a long outage cannot overflow the delay into Infinity or NaN", () => {
  for (const n of [1_000, 10_000, Number.MAX_SAFE_INTEGER]) {
    const d = pollDelayMs(n);
    assert.ok(Number.isFinite(d) && d === POLL_MAX_MS, `delay for ${n} failures must stay at the cap, got ${d}`);
  }
});

test("a nonsense failure count is treated as healthy, never as a NaN interval", () => {
  assert.equal(pollDelayMs(-3), POLL_BASE_MS);
  assert.equal(pollDelayMs(Number.NaN), POLL_BASE_MS);
});

test("one blip is not stale; two consecutive failures are", () => {
  // A single dropped request is papered over by the next poll — announcing it would
  // train the recruiter to ignore the pill. From the second, the tab is knowingly
  // rendering old data and has to say so.
  assert.equal(pollIsStale(0), false);
  assert.equal(pollIsStale(1), false);
  assert.equal(pollIsStale(2), true);
  assert.equal(pollIsStale(9), true);
});
