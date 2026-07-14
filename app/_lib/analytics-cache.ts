// Short-TTL per-(workspace, window) memo for the /api/analytics payload. Each request
// otherwise re-runs the full pipelineAnalytics aggregation TWICE (the current window,
// plus the prior equal-length window that feeds the period-over-period deltas). Within
// the TTL a repeat request for the SAME workspace + window serves the memoized payload
// instead of re-aggregating ~20 grouped queries.
//
// The TTL is deliberately small (seconds) so staleness is immaterial and NO write-path
// invalidation is needed — a pipeline write is reflected on the next request past the
// TTL, which is well inside a recruiter's read cadence. The key is (workspace, window),
// so a payload can NEVER cross tenants OR windows (the two isolation invariants the
// dashboard depends on). Pure + injectable clock so the keying + expiry are unit-testable.

const DEFAULT_TTL_MS = 20_000;

// A NUL joiner: workspace ids and the window token are both NUL-free, so the key is
// unambiguous (no "a" + "bc" vs "ab" + "c" collision across the two fields).
const SEP = "\u0000";

/** The memo key: workspace first, then the window (null = all-time). Two workspaces —
 *  or two windows within one workspace — never collide. Exposed for the keying test. */
export function analyticsCacheKey(workspaceId: string, windowDays: number | null): string {
  return `${workspaceId}${SEP}${windowDays == null ? "all" : windowDays}`;
}

type Entry<T> = { value: T; expiresAt: number };

export type AnalyticsCache<T> = {
  /** Return the memoized payload for (workspace, window) if still fresh, else compute,
   *  store, and return it. */
  get(workspaceId: string, windowDays: number | null, compute: () => T): T;
  /** Drop all entries (test hook / manual flush). */
  clear(): void;
};

/** Build a TTL memo. `ttlMs`/`now` are injectable so a test can drive expiry
 *  deterministically without wall-clock sleeps. */
export function createAnalyticsCache<T>(opts?: { ttlMs?: number; now?: () => number }): AnalyticsCache<T> {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts?.now ?? Date.now;
  const store = new Map<string, Entry<T>>();
  return {
    get(workspaceId, windowDays, compute) {
      const key = analyticsCacheKey(workspaceId, windowDays);
      const t = now();
      const hit = store.get(key);
      if (hit && hit.expiresAt > t) return hit.value;
      const value = compute();
      store.set(key, { value, expiresAt: t + ttlMs });
      return value;
    },
    clear() {
      store.clear();
    },
  };
}
