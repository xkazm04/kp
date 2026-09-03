// The Fit Matrix's scored-grid cache: bounded, content-addressed, LRU.
//
// GET /api/matrix held ONE in-process entry ("one corpus state matters; kp runs one
// server process"). That premise died with tenancy: the grid is scored per workspace
// from that workspace's profiles and open positions, so two tenants polling the tab
// evict each other on every request and the hit rate collapses to zero — every visit
// pays a Python spawn for a DETERMINISTIC O(N*M) computation. The same thrash happens
// for one tenant flipping between two states.
//
// A handful of entries fixes it, but only with a bound: the value is a whole scored
// grid (candidates x positions), so an unbounded map keyed by content hash is a slow
// memory leak — one entry per distinct corpus state, forever.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBoundedCache, matrixCacheKey, MATRIX_CACHE_CAPACITY } from "./matrix-cache.ts";

test("a stored value is served back under the same key", () => {
  const c = createBoundedCache<number>(3);
  c.set("a", 1);
  assert.equal(c.get("a"), 1);
  assert.equal(c.get("nope"), undefined);
  assert.equal(c.size, 1);
});

test("two keys coexist — the single-entry thrash this replaces", () => {
  const c = createBoundedCache<string>(3);
  c.set("tenant-a", "grid-a");
  c.set("tenant-b", "grid-b");
  // The old single-entry cache answered `undefined` here: B's write replaced A's.
  assert.equal(c.get("tenant-a"), "grid-a");
  assert.equal(c.get("tenant-b"), "grid-b");
});

test("capacity is a hard bound — the oldest entry is evicted, never the map's growth", () => {
  const c = createBoundedCache<number>(2);
  c.set("a", 1);
  c.set("b", 2);
  c.set("c", 3);
  assert.equal(c.size, 2, "the cache never exceeds its capacity");
  assert.equal(c.get("a"), undefined, "the least-recently-used entry is the one dropped");
  assert.equal(c.get("b"), 2);
  assert.equal(c.get("c"), 3);
});

test("a READ promotes: recency, not insertion order, decides the victim", () => {
  const c = createBoundedCache<number>(2);
  c.set("a", 1);
  c.set("b", 2);
  assert.equal(c.get("a"), 1); // a is now the most recently used
  c.set("c", 3);
  assert.equal(c.get("b"), undefined, "b was the least recently USED, so b goes");
  assert.equal(c.get("a"), 1, "the entry that was read survives");
  assert.equal(c.get("c"), 3);
});

test("re-setting an existing key refreshes it without growing the map", () => {
  const c = createBoundedCache<number>(2);
  c.set("a", 1);
  c.set("b", 2);
  c.set("a", 9);
  assert.equal(c.size, 2);
  assert.equal(c.get("a"), 9);
  c.set("c", 3);
  assert.equal(c.get("b"), undefined, "the re-set key was promoted, so b is the victim");
  assert.equal(c.get("a"), 9);
});

test("clear empties it (the test/flush hook)", () => {
  const c = createBoundedCache<number>(2);
  c.set("a", 1);
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(c.get("a"), undefined);
});

test("capacity below 1 is refused — a zero-capacity cache is a silent permanent miss", () => {
  assert.throws(() => createBoundedCache<number>(0), /capacity/);
  assert.throws(() => createBoundedCache<number>(-1), /capacity/);
});

test("the default capacity is small and positive", () => {
  assert.ok(MATRIX_CACHE_CAPACITY >= 2 && MATRIX_CACHE_CAPACITY <= 32, String(MATRIX_CACHE_CAPACITY));
  assert.equal(createBoundedCache<number>().size, 0);
});

// --- the key ---------------------------------------------------------------
// Content-addressed: profiles/jobs carry no updated_at column, so hashing the EXACT
// JSON handed to the scorer is the only edit-safe invalidation.

test("the key is stable for identical inputs and changes when any part changes", () => {
  const base = { workspaceId: "ws-a", profilesJson: '[{"id":"p1"}]', jobIds: "j1,j2", jobsJson: "[]" };
  assert.equal(matrixCacheKey(base), matrixCacheKey({ ...base }));
  assert.notEqual(matrixCacheKey(base), matrixCacheKey({ ...base, profilesJson: '[{"id":"p2"}]' }));
  assert.notEqual(matrixCacheKey(base), matrixCacheKey({ ...base, jobIds: "j1,j3" }));
  assert.notEqual(matrixCacheKey(base), matrixCacheKey({ ...base, jobsJson: '[{"id":"j1"}]' }));
});

test("the workspace is an explicit axis of the key, not an accident of the content", () => {
  // Two tenants can legitimately hold IDENTICAL profile/job JSON (a seeded demo corpus
  // cloned per workspace). The grid would then be the same, so this axis is not a
  // correctness fix — it keeps one tenant's entry from being read as another's, which
  // is the invariant the old cache carried in a comment and nothing else.
  const base = { profilesJson: "[]", jobIds: "", jobsJson: "[]" };
  assert.notEqual(matrixCacheKey({ ...base, workspaceId: "ws-a" }), matrixCacheKey({ ...base, workspaceId: "ws-b" }));
});

test("the parts are separated so they cannot be confused for one another", () => {
  // Concatenating without a separator would make ("ab","c") and ("a","bc") one key.
  assert.notEqual(
    matrixCacheKey({ workspaceId: "w", profilesJson: "ab", jobIds: "c", jobsJson: "" }),
    matrixCacheKey({ workspaceId: "w", profilesJson: "a", jobIds: "bc", jobsJson: "" })
  );
});
