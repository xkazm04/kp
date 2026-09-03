import { createHash } from "node:crypto";

// The scored-grid cache behind GET /api/matrix, extracted so it is unit-testable
// (the route needs a Next request scope; this needs nothing).
//
// What it replaces: ONE module-level entry, justified by "one corpus state matters;
// kp runs one server process". The second half is still true, the first is not —
// the grid is scored per WORKSPACE from that workspace's profiles and open
// positions, so two tenants with the tab open evicted each other on every poll and
// the hit rate fell to zero. Each miss is a Python spawn plus an O(N*M) rescore of a
// DETERMINISTIC computation, which is precisely what the cache existed to avoid.
//
// Why bounded rather than a plain Map: the value is a whole grid (candidates x
// positions x cells), and the key is a content hash, so an unbounded map holds one
// entry per distinct corpus state FOREVER — a slow leak that grows with every edit
// to any profile or job. A handful of entries covers the real access pattern (a few
// tenants, each on one or two corpus states) and the bound makes the worst case a
// stated number instead of an open question.

/** Entries kept. Sized for "a few tenants, each on a state or two"; a miss costs one
 *  Python spawn, so overshooting buys little and each entry is a whole grid. */
export const MATRIX_CACHE_CAPACITY = 8;

export type BoundedCache<V> = {
  /** The value for `key`, promoting it to most-recently-used. */
  get(key: string): V | undefined;
  /** Store `value`, evicting the least-recently-used entry when at capacity. */
  set(key: string, value: V): void;
  /** Current entry count (never above capacity). */
  readonly size: number;
  /** Drop everything — the flush/test hook. */
  clear(): void;
};

/**
 * A minimal LRU over an insertion-ordered Map: a `get` deletes and re-inserts to move
 * the entry to the end, so the FIRST key is always the least recently used and is the
 * one evicted at capacity. No timers, no TTL — invalidation here is by CONTENT
 * (matrixCacheKey), so a stale entry is unreachable rather than expired.
 */
export function createBoundedCache<V>(capacity: number = MATRIX_CACHE_CAPACITY): BoundedCache<V> {
  if (!Number.isInteger(capacity) || capacity < 1) {
    // A zero/negative capacity would be a cache that silently never hits — the
    // failure mode is a permanent, invisible performance regression, so refuse it
    // at construction rather than serve misses forever.
    throw new Error(`matrix cache capacity must be a positive integer, got ${capacity}`);
  }
  const entries = new Map<string, V>();
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key) as V;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      // Delete first so a re-set is a promotion, not an in-place update that would
      // leave a hot key sitting at the eviction end.
      entries.delete(key);
      entries.set(key, value);
      if (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
    },
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  };
}

/**
 * Content-address the EXACT inputs handed to the scorer. Profiles and jobs carry no
 * `updated_at` column, so hashing the real payload is the only edit-safe
 * invalidation — the same contract the reasoning cache's job content hash follows.
 *
 * `workspaceId` is an EXPLICIT axis. Two tenants can legitimately hold identical
 * profile/job JSON (a seeded demo corpus cloned per workspace), so this is not a
 * correctness fix for the grid's contents; it makes "one tenant's grid is never read
 * as another's" a property of the key rather than an invariant carried by a comment.
 *
 * Parts are NUL-separated: a bare concatenation would let ("ab", "c") and
 * ("a", "bc") collide.
 */
export function matrixCacheKey(input: {
  workspaceId: string;
  profilesJson: string;
  jobIds: string;
  jobsJson: string;
}): string {
  return createHash("sha1")
    .update(input.workspaceId)
    .update("\u0000")
    .update(input.profilesJson)
    .update("\u0000")
    .update(input.jobIds)
    .update("\u0000")
    .update(input.jobsJson)
    .digest("hex");
}
