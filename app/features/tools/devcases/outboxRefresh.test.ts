// The Outbox's return-to-tab refresh trigger. There is no jsdom in this repo, so the
// LISTENERS cannot be exercised — which is exactly why the decision they carry was
// extracted: the interesting part is not addEventListener, it is which of the two
// overlapping "the reader came back" events should actually spend a request.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTBOX_RETURN_MIN_INTERVAL_MS, shouldReloadOnReturn } from "./outboxRefresh.ts";

const at = (now: number, over: Partial<Parameters<typeof shouldReloadOnReturn>[0]> = {}) =>
  shouldReloadOnReturn({ event: "focus", visibility: "visible", lastAttemptAt: null, now, ...over });

test("coming back to the tab refreshes", () => {
  assert.equal(at(1_000), true, "first return after mount, nothing loaded since");
  assert.equal(at(1_000, { event: "visibilitychange" }), true, "either event means the same thing");
  assert.equal(
    at(100_000, { lastAttemptAt: 100_000 - OUTBOX_RETURN_MIN_INTERVAL_MS }),
    true,
    "a return past the window refreshes again",
  );
});

test("LEAVING the tab never fetches", () => {
  // `visibilitychange` fires in both directions. Treating it as a return would spend a
  // request every time the reader switches AWAY, on a table nobody is looking at.
  assert.equal(at(1_000, { event: "visibilitychange", visibility: "hidden" }), false);
  // …and a `focus` delivered while the document is hidden is not a reader either.
  assert.equal(at(1_000, { visibility: "hidden" }), false);
});

test("one return is one fetch, not two", () => {
  // Switching back to a background tab fires visibilitychange AND focus, microseconds
  // apart. The first records its attempt; the second must be suppressed.
  const now = 50_000;
  assert.equal(at(now, { event: "visibilitychange" }), true);
  assert.equal(at(now + 3, { lastAttemptAt: now }), false, "the second half of the same return is dropped");
});

test("an alt-tabbing reader is throttled, and a failing endpoint is not hammered", () => {
  const start = 200_000;
  // `lastAttemptAt` is when the load was STARTED, so this holds whether or not it
  // succeeded — the stale pill is already reporting the failure.
  for (const dt of [1, 1_000, OUTBOX_RETURN_MIN_INTERVAL_MS - 1]) {
    assert.equal(at(start + dt, { lastAttemptAt: start }), false, `+${dt}ms is inside the window`);
  }
  assert.equal(at(start + OUTBOX_RETURN_MIN_INTERVAL_MS, { lastAttemptAt: start }), true);
});
