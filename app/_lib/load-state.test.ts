// Locks the "empty data vs. failed load" contract that lets the Dev Case Studio
// tell a genuinely empty pipeline apart from an outage. The whole feature hinges
// on `isLoadFailure` NOT classifying a successful-but-empty response as a
// failure (and vice-versa: a non-OK / error-envelope / non-JSON response must
// never render as an innocuous blank). `aggregateLoadState` backs the control
// room's single banner over its two pollers.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoadFailure, aggregateLoadState } from "./load-state.ts";

test("a successful but empty response is NOT a failure", () => {
  // The crux of the requirement: empty data must render as "nothing here yet",
  // never as an outage. An empty array/object payload is a healthy empty result.
  assert.equal(isLoadFailure(true, {}), false);
  assert.equal(isLoadFailure(true, { cases: [] }), false);
  assert.equal(isLoadFailure(true, { lifecycles: [], postings: [] }), false);
});

test("a non-OK HTTP status is a failure regardless of body", () => {
  assert.equal(isLoadFailure(false, { cases: [1, 2] }), true);
  assert.equal(isLoadFailure(false, {}), true);
  assert.equal(isLoadFailure(false, null), true);
});

test("a missing / non-JSON body is a failure", () => {
  // `res.json()` threw → body is null. Must not be mistaken for empty data.
  assert.equal(isLoadFailure(true, null), true);
});

test("an API error envelope is a failure even on a 200", () => {
  assert.equal(isLoadFailure(true, { error: "boom" }), true);
  assert.equal(isLoadFailure(true, { error: "db down", cases: [] }), true);
});

test("a falsy `error` field does not trip the failure check", () => {
  // Mirrors the truthy semantics of the original `body.error` guard: an empty
  // or absent error string is a healthy payload, not a failure.
  assert.equal(isLoadFailure(true, { error: "" }), false);
  assert.equal(isLoadFailure(true, { error: null }), false);
});

test("aggregate is healthy only when every loader is healthy", () => {
  assert.equal(aggregateLoadState([
    { failed: false, lastUpdated: 100 },
    { failed: false, lastUpdated: 200 },
  ]).failed, false);
});

test("aggregate fails if ANY loader failed", () => {
  assert.equal(aggregateLoadState([
    { failed: false, lastUpdated: 100 },
    { failed: true, lastUpdated: 200 },
  ]).failed, true);
});

test("aggregate reports the OLDEST fresh point (most conservative age)", () => {
  // A stale loader behind an outage should set the banner's clock, even if a
  // sibling loader refreshed more recently.
  const merged = aggregateLoadState([
    { failed: true, lastUpdated: 100 },
    { failed: false, lastUpdated: 500 },
  ]);
  assert.equal(merged.lastUpdated, 100);
});

test("aggregate ignores loaders that never succeeded when dating freshness", () => {
  const merged = aggregateLoadState([
    { failed: true, lastUpdated: null },
    { failed: false, lastUpdated: 300 },
  ]);
  assert.equal(merged.lastUpdated, 300);
});

test("aggregate of all-never-loaded has no timestamp", () => {
  assert.deepEqual(
    aggregateLoadState([
      { failed: true, lastUpdated: null },
      { failed: false, lastUpdated: null },
    ]),
    { failed: true, lastUpdated: null },
  );
});

test("aggregate of an empty loader list is healthy with no timestamp", () => {
  assert.deepEqual(aggregateLoadState([]), { failed: false, lastUpdated: null });
});
