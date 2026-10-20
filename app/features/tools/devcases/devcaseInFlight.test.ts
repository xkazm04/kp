// Close sees who is mid-case (challenge-r06 devcase-session-api/B).
//
// The postings GET carries a per-posting in-flight aggregate (counts only). The studio
// folds it per case, the way it already folds submissions, and the close confirm names
// the live attempts it would cut off. Idle attempts (no activity in the live window) are
// abandoned tabs, not people mid-case, so they never raise the warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeWarning, inFlightByCase, NO_IN_FLIGHT } from "./devcaseInFlight.ts";

const NOW = Date.parse("2026-09-23T12:00:00Z");
const minsAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

test("closeWarning: live attempts name the count and the longest elapsed minutes", () => {
  assert.deepEqual(closeWarning({ live: 2, idle: 0, oldestLiveStartedAt: minsAgo(52) }, NOW), {
    key: "lifecycle.closeInFlight",
    values: { count: 2, minutes: 52 },
  });
});

test("closeWarning: only idle attempts (or none) do not alarm", () => {
  assert.equal(closeWarning({ live: 0, idle: 3, oldestLiveStartedAt: null }, NOW), null);
  assert.equal(closeWarning(NO_IN_FLIGHT, NOW), null);
  assert.equal(closeWarning(undefined, NOW), null);
});

test("closeWarning: an unparseable start still warns, with 0 minutes rather than NaN", () => {
  assert.deepEqual(closeWarning({ live: 1, idle: 0, oldestLiveStartedAt: "not a date" }, NOW), {
    key: "lifecycle.closeInFlight",
    values: { count: 1, minutes: 0 },
  });
});

test("inFlightByCase: postings of one case sum, the oldest live start wins, a caseless posting contributes nothing", () => {
  const byCase = inFlightByCase([
    { caseId: "K", inFlight: { live: 1, idle: 0, oldestLiveStartedAt: minsAgo(10) } },
    { caseId: "K", inFlight: { live: 2, idle: 1, oldestLiveStartedAt: minsAgo(40) } },
    { caseId: null, inFlight: { live: 5, idle: 5, oldestLiveStartedAt: minsAgo(90) } },
    { caseId: "L" },
  ]);
  assert.deepEqual(byCase.get("K"), { live: 3, idle: 1, oldestLiveStartedAt: minsAgo(40) });
  assert.equal(byCase.has("L"), false, "a posting that carries no aggregate adds no entry");
  assert.equal(byCase.size, 1);
});

test("inFlightByCase: a live posting with a null start does not erase another posting's start", () => {
  const byCase = inFlightByCase([
    { caseId: "K", inFlight: { live: 0, idle: 2, oldestLiveStartedAt: null } },
    { caseId: "K", inFlight: { live: 1, idle: 0, oldestLiveStartedAt: minsAgo(7) } },
  ]);
  assert.deepEqual(byCase.get("K"), { live: 1, idle: 2, oldestLiveStartedAt: minsAgo(7) });
});
