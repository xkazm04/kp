// The generic short-TTL, bounded, string-keyed memo. It used to live in
// analytics-cache.ts, and living there was not a naming quibble: `createAnalyticsCache`
// folds a per-workspace ANALYTICS WRITE VERSION into its key, and every consumer that
// reached for "the TTL memo idiom" reached for the analytics module — so the pipeline
// score memo (pipeline-score-cache.ts) was built on `createAnalyticsCache` and an
// /api/analytics/spend or /targets write silently retired the canonical-score map too.
// Nothing was wrong with the score map; it was collateral of a key it never asked for.
//
// So the core lives here, dependency-free, with NO invalidation policy of its own:
// TTL + a hard entry bound, nothing else. A module that wants write invalidation
// (analytics) composes it on top with a key of its own; a module that wants pure TTL
// (profiles, pipeline scores) uses this directly and is coupled to nobody.
//
// The isolation invariant is the caller's key: two distinct keys never share an entry,
// so no payload crosses tenants or any other keyed axis. Every consumer keys
// workspace-first, which makes tenant isolation structural rather than incidental.

const DEFAULT_TTL_MS = 20_000;

// A hard ceiling on retained entries. The TTL alone is NOT a bound: expiry was
// only ever checked on READ, so an entry whose key is never requested again sat
// in the Map for the life of the process. Three call sites key this cache on raw
// query params -- ?candidate on /api/decisions/records, ?roleFamily on both
// calibration routes -- none of which is a closed vocabulary, so distinct values
// accumulated one retained payload each (for the records route, a whole verified
// chain plus its resolver map). `maxDuration` is serverless-only here, so a
// self-hosted `next start` process is long-lived by design and nothing ever
// reclaimed them. 256 is far above the working set of any real read cadence:
// only entries created inside one TTL window can still be live, and the sweep
// below reclaims the rest before evicting anything fresh.
const DEFAULT_MAX_ENTRIES = 256;

/** A NUL joiner for composite keys: workspace ids, window tokens, source tokens,
 *  role-family names and candidate refs are all NUL-free, so a concatenation is
 *  unambiguous (no "a" + "bc" vs "ab" + "c" collision across two fields). */
export const KEY_SEP = "\u0000";

// The "no value here" marker: KEY_SEP again, so the key carries two adjacent NULs.
// An ABSENT optional field ("no family filter", "the full records list") cannot be
// forged by any real value precisely because values are NUL-free. The previous
// marker was a printable "*", and every one of these fields arrives as a raw query
// param: `?roleFamily=*` and `?candidate=*` keyed to the SAME entry as the
// unfiltered load, so whichever request landed first had its payload served to the
// other for the rest of the TTL. "In practice nobody names a family `*`" is not a
// property of a URL.
const NONE = KEY_SEP;

/** An optional key field: its own value, or the unforgeable absent-marker. Empty
 *  string collapses to absent — every caller's filtered/unfiltered branch already
 *  treats "" as "no filter", so the key must agree with the payload it stores. */
export const optionalKeyField = (value: string | null | undefined): string => (value ? value : NONE);

type Entry<T> = { value: T; expiresAt: number };

export type TtlCache<T> = {
  /** Return the memoized value for `key` if still fresh, else compute, store,
   *  and return it. */
  get(key: string, compute: () => T): T;
  /** Drop all entries (test hook / manual flush). */
  clear(): void;
};

/** Build a string-keyed TTL memo, bounded at `maxEntries` (default
 *  {@link DEFAULT_MAX_ENTRIES}) so a caller-built key axis cannot grow it without
 *  limit. `ttlMs`/`now`/`maxEntries` are injectable so a test can drive expiry and
 *  eviction deterministically without wall-clock sleeps. Module-scope one per route
 *  so it persists across requests.
 *
 *  The TTL is deliberately small (seconds) so staleness is immaterial and NO
 *  write-path invalidation is needed here — a write lands on the next read past the
 *  TTL, well inside a reader's cadence. A consumer that needs a write to land
 *  IMMEDIATELY (an inline editor that reloads on save) must say so with a key of its
 *  own or a clear(); it does not get it from this module by default. */
export function createTtlCache<T>(opts?: { ttlMs?: number; now?: () => number; maxEntries?: number }): TtlCache<T> {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts?.now ?? Date.now;
  const maxEntries = Math.max(1, opts?.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const store = new Map<string, Entry<T>>();
  return {
    get(key, compute) {
      const t = now();
      const hit = store.get(key);
      if (hit && hit.expiresAt > t) return hit.value;
      // Drop a stale hit before recomputing: the re-insert below then moves the key
      // to the END of the Map's insertion order, which is what makes that order a
      // usable recency proxy for the eviction pass.
      if (hit) store.delete(key);
      const value = compute();
      if (store.size >= maxEntries) {
        // Reclaim what the TTL already invalidated first -- an expired entry is
        // free to drop, a fresh one is a recompute someone will pay for.
        for (const [k, e] of store) if (e.expiresAt <= t) store.delete(k);
        // Still full: evict oldest-first. Map iterates in insertion order and every
        // live entry was inserted when it was computed, so the head is the least
        // recently computed key.
        while (store.size >= maxEntries) {
          const oldest = store.keys().next();
          if (oldest.done) break;
          store.delete(oldest.value);
        }
      }
      store.set(key, { value, expiresAt: t + ttlMs });
      return value;
    },
    clear() {
      store.clear();
    },
  };
}
