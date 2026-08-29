import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyticsCacheKey,
  createAnalyticsCache,
  createTtlCache,
  calibrationCacheKey,
  calibrationBandCacheKey,
  decisionRecordsCacheKey,
} from "./analytics-cache.ts";

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

// ── Generic keyed TTL core (calibration / band / records) ──────────────────

test("createTtlCache: hit within TTL, miss after, no recompute on hit", () => {
  let clock = 1_000;
  const cache = createTtlCache<number>({ ttlMs: 20_000, now: () => clock });
  let calls = 0;
  const compute = () => {
    calls += 1;
    return calls;
  };
  assert.equal(cache.get("k", compute), 1);
  clock += 19_999; // inside TTL → served from memo
  assert.equal(cache.get("k", compute), 1);
  assert.equal(calls, 1, "repeat read within the TTL did not recompute");
  clock += 2; // past expiresAt (1000 + 20000)
  assert.equal(cache.get("k", compute), 2);
  assert.equal(calls, 2, "recomputed once the TTL lapsed");
});

test("createTtlCache: distinct keys never share an entry", () => {
  const cache = createTtlCache<string>({ now: () => 0 });
  let calls = 0;
  const compute = (label: string) => () => {
    calls += 1;
    return label;
  };
  assert.equal(cache.get("k1", compute("A")), "A");
  assert.equal(cache.get("k2", compute("B")), "B"); // different key → its own compute
  assert.equal(calls, 2);
  assert.equal(cache.get("k1", compute("A2")), "A"); // k1 still memoized
  assert.equal(cache.get("k2", compute("B2")), "B"); // k2 still memoized
  assert.equal(calls, 2, "repeat reads served from the memo, no cross-key bleed");
});

test("calibrationCacheKey isolates every axis (workspace, source, family)", () => {
  // Workspace axis.
  assert.notEqual(calibrationCacheKey("ws-a", "pipeline", null), calibrationCacheKey("ws-b", "pipeline", null));
  // Source axis.
  assert.notEqual(calibrationCacheKey("ws-a", "pipeline", null), calibrationCacheKey("ws-a", "analysis", null));
  // Family axis.
  assert.notEqual(calibrationCacheKey("ws-a", "pipeline", "eng"), calibrationCacheKey("ws-a", "pipeline", "sales"));
  // Null/empty family collapse to the same "no filter" key.
  assert.equal(calibrationCacheKey("ws-a", "pipeline", null), calibrationCacheKey("ws-a", "pipeline", ""));
  // Identical inputs → identical key (a hit is possible at all).
  assert.equal(calibrationCacheKey("ws-a", "pipeline", "eng"), calibrationCacheKey("ws-a", "pipeline", "eng"));
});

test("calibrationBandCacheKey isolates every axis including the bin", () => {
  const base = calibrationBandCacheKey("ws-a", "pipeline", "eng", 3);
  assert.notEqual(base, calibrationBandCacheKey("ws-b", "pipeline", "eng", 3)); // workspace
  assert.notEqual(base, calibrationBandCacheKey("ws-a", "analysis", "eng", 3)); // source
  assert.notEqual(base, calibrationBandCacheKey("ws-a", "pipeline", "sales", 3)); // family
  assert.notEqual(base, calibrationBandCacheKey("ws-a", "pipeline", "eng", 7)); // bin
  assert.equal(base, calibrationBandCacheKey("ws-a", "pipeline", "eng", 3)); // identical → hit
});

test("a literal \"*\" filter cannot forge the no-filter key", () => {
  // Every one of these fields arrives as a raw query param, so the absent-marker
  // must be unspellable. With the old printable "*" sentinel, `?candidate=*`
  // computed the FILTERED result (an empty list) and stored it under the key the
  // full-list view reads — and `?roleFamily=*` did the same to the unfiltered
  // calibration payload — for the rest of the TTL.
  assert.notEqual(decisionRecordsCacheKey("ws-a", "*"), decisionRecordsCacheKey("ws-a", null));
  assert.notEqual(calibrationCacheKey("ws-a", "pipeline", "*"), calibrationCacheKey("ws-a", "pipeline", null));
  assert.notEqual(
    calibrationBandCacheKey("ws-a", "pipeline", "*", 3),
    calibrationBandCacheKey("ws-a", "pipeline", null, 3)
  );
  // A "*" family is still a stable key of its own — distinguished, not dropped.
  assert.equal(calibrationCacheKey("ws-a", "pipeline", "*"), calibrationCacheKey("ws-a", "pipeline", "*"));
});

test("an empty ?candidate keys as the full list, matching what the route computes", () => {
  // The route branches on `candidate ? filtered : unfiltered`, so "" IS the full
  // list. The key used to disagree (`?? "*"` keeps ""), giving the same payload two
  // entries — a wasted recompute, and two truths for one view.
  assert.equal(decisionRecordsCacheKey("ws-a", ""), decisionRecordsCacheKey("ws-a", null));
});

test("decisionRecordsCacheKey isolates workspace and candidate subject", () => {
  assert.notEqual(decisionRecordsCacheKey("ws-a", null), decisionRecordsCacheKey("ws-b", null)); // tenant
  assert.notEqual(decisionRecordsCacheKey("ws-a", null), decisionRecordsCacheKey("ws-a", "cand-1")); // full-list vs dossier
  assert.notEqual(decisionRecordsCacheKey("ws-a", "cand-1"), decisionRecordsCacheKey("ws-a", "cand-2")); // two subjects
  assert.equal(decisionRecordsCacheKey("ws-a", "cand-1"), decisionRecordsCacheKey("ws-a", "cand-1")); // identical → hit
});
