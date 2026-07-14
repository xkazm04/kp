import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsCacheKey, createAnalyticsCache } from "./analytics-cache.ts";

test("analyticsCacheKey isolates workspaces and windows", () => {
  // Two workspaces, same window → distinct keys (no cross-tenant bleed).
  assert.notEqual(analyticsCacheKey("ws-a", 30), analyticsCacheKey("ws-b", 30));
  // One workspace, two windows → distinct keys (no cross-window bleed).
  assert.notEqual(analyticsCacheKey("ws-a", 30), analyticsCacheKey("ws-a", 90));
  // All-time (null) is its own key, distinct from any numeric window.
  assert.notEqual(analyticsCacheKey("ws-a", null), analyticsCacheKey("ws-a", 7));
  // Identical (workspace, window) → identical key (a hit is possible at all).
  assert.equal(analyticsCacheKey("ws-a", 30), analyticsCacheKey("ws-a", 30));
});

test("the memo never shares an entry across workspaces", () => {
  const cache = createAnalyticsCache<string>({ now: () => 0 });
  let calls = 0;
  const compute = (label: string) => () => {
    calls += 1;
    return label;
  };
  const a = cache.get("ws-a", 30, compute("A"));
  const b = cache.get("ws-b", 30, compute("B")); // same window, different workspace
  assert.equal(a, "A");
  assert.equal(b, "B"); // ws-b did NOT read ws-a's payload
  assert.equal(calls, 2, "each workspace computed its own payload");
  // Repeat within TTL: both served from the memo, no recompute.
  assert.equal(cache.get("ws-a", 30, compute("A2")), "A");
  assert.equal(cache.get("ws-b", 30, compute("B2")), "B");
  assert.equal(calls, 2, "repeat reads within the TTL did not re-aggregate");
});

test("the memo never shares an entry across windows within one workspace", () => {
  const cache = createAnalyticsCache<string>({ now: () => 0 });
  let calls = 0;
  const compute = (label: string) => () => {
    calls += 1;
    return label;
  };
  assert.equal(cache.get("ws-a", 30, compute("W30")), "W30");
  assert.equal(cache.get("ws-a", 90, compute("W90")), "W90"); // different window recomputes
  assert.equal(cache.get("ws-a", null, compute("ALL")), "ALL"); // all-time recomputes
  assert.equal(calls, 3);
});

test("an entry recomputes once the TTL lapses", () => {
  let clock = 1_000;
  const cache = createAnalyticsCache<number>({ ttlMs: 20_000, now: () => clock });
  let calls = 0;
  const compute = () => {
    calls += 1;
    return calls;
  };
  assert.equal(cache.get("ws-a", 30, compute), 1);
  clock += 19_999; // still inside the TTL
  assert.equal(cache.get("ws-a", 30, compute), 1);
  assert.equal(calls, 1);
  clock += 2; // now past expiresAt (1000 + 20000)
  assert.equal(cache.get("ws-a", 30, compute), 2);
  assert.equal(calls, 2);
});
