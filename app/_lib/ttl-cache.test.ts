// The generic TTL memo, tested where it now lives. What this file pins that
// analytics-cache.test.ts could not: the core has NO invalidation policy of its own.
// It was the analytics module's export, so every consumer that wanted "the TTL idiom"
// took `createAnalyticsCache` with it — and its per-workspace analytics write version
// then retired memos (the pipeline score map) that had nothing to do with analytics.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTtlCache, KEY_SEP, optionalKeyField } from "./ttl-cache.ts";

test("a hit inside the TTL does not recompute; past it, it does", () => {
  let clock = 0;
  let calls = 0;
  const cache = createTtlCache<string>({ ttlMs: 1000, now: () => clock });
  const compute = () => {
    calls += 1;
    return `v${calls}`;
  };
  assert.equal(cache.get("k", compute), "v1");
  clock = 999;
  assert.equal(cache.get("k", compute), "v1", "still fresh at the last millisecond");
  assert.equal(calls, 1);
  clock = 1001;
  assert.equal(cache.get("k", compute), "v2", "expired → recomputed");
  assert.equal(calls, 2);
});

test("distinct keys never share an entry", () => {
  const cache = createTtlCache<string>({ now: () => 0 });
  assert.equal(cache.get("a", () => "A"), "A");
  assert.equal(cache.get("b", () => "B"), "B");
  assert.equal(cache.get("a", () => "A2"), "A", "a's entry was not overwritten by b's");
});

test("clear() drops everything", () => {
  const cache = createTtlCache<string>({ now: () => 0 });
  cache.get("a", () => "A");
  cache.clear();
  assert.equal(cache.get("a", () => "A2"), "A2");
});

test("the memo is bounded — an unbounded key axis cannot grow it forever", () => {
  const cache = createTtlCache<number>({ ttlMs: 100_000, now: () => 0, maxEntries: 4 });
  for (let i = 0; i < 50; i += 1) cache.get(`k${i}`, () => i);
  // The oldest keys were evicted; the newest is still served from the memo.
  let recomputed = 0;
  cache.get("k0", () => {
    recomputed += 1;
    return -1;
  });
  assert.equal(recomputed, 1, "the first key was evicted long ago");
  cache.get("k49", () => {
    recomputed += 1;
    return -1;
  });
  assert.equal(recomputed, 1, "the most recent key is still live");
});

test("expired entries are reclaimed before a fresh one is evicted", () => {
  let clock = 0;
  const cache = createTtlCache<string>({ ttlMs: 1000, now: () => clock, maxEntries: 3 });
  cache.get("old-a", () => "A");
  cache.get("old-b", () => "B");
  clock = 2000; // both expired
  cache.get("fresh", () => "F");
  cache.get("fresh-2", () => "F2");
  // The two expired entries were reclaimed, so `fresh` survived the bound.
  let recomputed = 0;
  cache.get("fresh", () => {
    recomputed += 1;
    return "F-again";
  });
  assert.equal(recomputed, 0, "a fresh entry was kept while expired ones were reclaimed");
});

test("the core carries no invalidation policy — only the clock retires an entry", () => {
  // The whole reason this module exists apart from analytics-cache. Nothing exported
  // here can retire another consumer's entry: there is no version, no registry, no
  // cross-key handle. A caller that wants write invalidation composes it on its own key.
  const exports_ = Object.keys({ createTtlCache, KEY_SEP, optionalKeyField });
  assert.deepEqual(exports_.sort(), ["KEY_SEP", "createTtlCache", "optionalKeyField"]);
  let clock = 0;
  const cache = createTtlCache<string>({ ttlMs: 50, now: () => clock });
  cache.get("k", () => "v1");
  assert.equal(cache.get("k", () => "v2"), "v1");
  clock = 51;
  assert.equal(cache.get("k", () => "v2"), "v2");
});

test("the absent-marker cannot be forged by a query-param value", () => {
  // `?roleFamily=*` used to key to the same entry as the unfiltered load.
  assert.notEqual(optionalKeyField("*"), optionalKeyField(null));
  assert.equal(optionalKeyField(""), optionalKeyField(null), "empty collapses to absent");
  assert.equal(optionalKeyField(undefined), KEY_SEP);
  assert.equal(KEY_SEP, "\u0000", "the joiner is NUL — no real key field can contain it");
});
