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

// ── Generic keyed TTL core ────────────────────────────────────────────────
// The same short-TTL memo, but keyed by a caller-built string so sibling
// dashboards (calibration, its per-bin drilldown, the sealed decision records)
// can reuse ONE caching philosophy with their own key axes instead of forking a
// new one each. The isolation invariant is identical: two distinct keys never
// share an entry, so no payload crosses tenants OR any other keyed axis. Every
// consumer keys workspace-first (see the *CacheKey builders below), so tenant
// isolation is structural, not incidental.
//
// SAME TTL, SAME REASONING as the (workspace, window) memo above: the window is
// seconds, so staleness is immaterial and NO write-path invalidation is needed —
// a write lands on the next read past the TTL, well inside a recruiter's read
// cadence. For the decision-records chain-verification result this means a tamper
// introduced mid-TTL surfaces within `ttlMs` (~20s) of the next read rather than
// instantly; that bounded lag is an accepted trade-off (the sealed chain itself
// is immutable — only the freshness of the verdict is capped).

export type TtlCache<T> = {
  /** Return the memoized value for `key` if still fresh, else compute, store,
   *  and return it. */
  get(key: string, compute: () => T): T;
  /** Drop all entries (test hook / manual flush). */
  clear(): void;
};

/** Build a string-keyed TTL memo. `ttlMs`/`now` are injectable so a test can
 *  drive expiry deterministically without wall-clock sleeps. Module-scope one
 *  per route so it persists across requests. */
export function createTtlCache<T>(opts?: { ttlMs?: number; now?: () => number }): TtlCache<T> {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts?.now ?? Date.now;
  const store = new Map<string, Entry<T>>();
  return {
    get(key, compute) {
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

// ── Per-route key builders ────────────────────────────────────────────────
// All NUL-joined for the same reason as analyticsCacheKey: workspace ids, the
// source token, and role-family names are NUL-free, so the concatenation is
// collision-free. A null/empty role family collapses to the "*" sentinel so the
// "no family filter" load keys distinctly from any real family named literally
// "*" would still differ (family names are never a bare "*" in practice, and the
// filtered/unfiltered code paths already treat "" as "no filter").

/** Calibration payload key: (workspace, source, family). The families list is
 *  computed from the UNFILTERED set so it's identical across family keys — that
 *  redundancy is harmless; the payload stays byte-identical to a live compute. */
export function calibrationCacheKey(workspaceId: string, source: string, roleFamily: string | null): string {
  return `${workspaceId}${SEP}${source}${SEP}${roleFamily || "*"}`;
}

/** Per-bin drilldown key: (workspace, source, family, bin). Each bin is its own
 *  entry so opening bin 3 never serves bin 7's candidates. */
export function calibrationBandCacheKey(
  workspaceId: string,
  source: string,
  roleFamily: string | null,
  bin: number
): string {
  return `${workspaceId}${SEP}${source}${SEP}${roleFamily || "*"}${SEP}${bin}`;
}

/** Decision-records key: (workspace, candidate). The heavy work (chain verify +
 *  live-board resolver map) is workspace-only, but the records LIST is filtered by
 *  the optional ?candidate subject, so the subject is part of the key — otherwise a
 *  candidate-scoped load would poison the all-records view. `null` = the full list. */
export function decisionRecordsCacheKey(workspaceId: string, candidateRef: string | null): string {
  return `${workspaceId}${SEP}${candidateRef ?? "*"}`;
}

export type AnalyticsCache<T> = {
  /** Return the memoized payload for (workspace, window) if still fresh, else compute,
   *  store, and return it. */
  get(workspaceId: string, windowDays: number | null, compute: () => T): T;
  /** Drop all entries (test hook / manual flush). */
  clear(): void;
};

/** Build a TTL memo keyed by (workspace, window). Thin wrapper over the generic
 *  string-keyed core so the /api/analytics route keeps its typed call shape.
 *  `ttlMs`/`now` are injectable so a test can drive expiry deterministically
 *  without wall-clock sleeps. */
export function createAnalyticsCache<T>(opts?: { ttlMs?: number; now?: () => number }): AnalyticsCache<T> {
  const inner = createTtlCache<T>(opts);
  return {
    get(workspaceId, windowDays, compute) {
      return inner.get(analyticsCacheKey(workspaceId, windowDays), compute);
    },
    clear() {
      inner.clear();
    },
  };
}
