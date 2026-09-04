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

/** Build a string-keyed TTL memo, bounded at `maxEntries` (default
 *  {@link DEFAULT_MAX_ENTRIES}) so a caller-built key axis cannot grow it without
 *  limit. `ttlMs`/`now`/`maxEntries` are injectable so a test can drive expiry and
 *  eviction deterministically without wall-clock sleeps. Module-scope one per route
 *  so it persists across requests. */
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

// ── Per-route key builders ────────────────────────────────────────────────
// All NUL-joined for the same reason as analyticsCacheKey: workspace ids, the
// source token, role-family names and candidate refs are NUL-free, so the
// concatenation is collision-free.
//
// An ABSENT optional field ("no family filter", "the full records list") is
// marked with `NONE` — a second, doubled separator, which no real value can
// forge precisely because values are NUL-free. The previous marker was a
// printable "*", and every one of these fields arrives as a raw query param:
// `?roleFamily=*` and `?candidate=*` keyed to the SAME entry as the unfiltered
// load, so whichever request landed first had its payload served to the other
// for the rest of the TTL (a `?candidate=*` probe returns an empty list, and
// that empty list then WAS the full decision-records view). "In practice nobody
// names a family `*`" is not a property of a URL.

// The "no value here" marker: SEP again, so the key carries two adjacent NULs.
const NONE = SEP;

/** An optional key field: its own value, or the unforgeable absent-marker. Empty
 *  string collapses to absent — every caller's filtered/unfiltered branch already
 *  treats "" as "no filter", so the key must agree with the payload it stores. */
const field = (value: string | null | undefined): string => (value ? value : NONE);

/** Calibration payload key: (workspace, source, family). The families list is
 *  computed from the UNFILTERED set so it's identical across family keys — that
 *  redundancy is harmless; the payload stays byte-identical to a live compute. */
export function calibrationCacheKey(workspaceId: string, source: string, roleFamily: string | null): string {
  return `${workspaceId}${SEP}${source}${SEP}${field(roleFamily)}`;
}

/** Per-bin drilldown key: (workspace, source, family, bin). Each bin is its own
 *  entry so opening bin 3 never serves bin 7's candidates. */
export function calibrationBandCacheKey(
  workspaceId: string,
  source: string,
  roleFamily: string | null,
  bin: number
): string {
  return `${workspaceId}${SEP}${source}${SEP}${field(roleFamily)}${SEP}${bin}`;
}

/** Decision-records key: (workspace, candidate). The heavy work (chain verify +
 *  live-board resolver map) is workspace-only, but the records LIST is filtered by
 *  the optional ?candidate subject, so the subject is part of the key — otherwise a
 *  candidate-scoped load would poison the all-records view. `null`/"" = the full
 *  list, and the marker for it cannot be spelled by any `?candidate=` value. */
export function decisionRecordsCacheKey(workspaceId: string, candidateRef: string | null): string {
  return `${workspaceId}${SEP}${field(candidateRef)}`;
}

// ── Write-path invalidation ───────────────────────────────────────────────
// The TTL comment above says a write "lands on the next read past the TTL, well
// inside a recruiter's read cadence". That reasoning holds for a PIPELINE write
// nobody is watching. It does NOT hold for the two analytics WRITE DOORS
// (/api/analytics/targets, /api/analytics/spend): both are inline editors that
// call `reload()` the instant they succeed, so the read they trigger lands
// milliseconds after the write and is served the PRE-WRITE payload for up to the
// whole TTL. The recruiter sets a 40 % conversion goal, watches the panel
// reload, and reads back the old goal line with nothing on screen saying why.
//
// A per-workspace WRITE VERSION rather than a clear(): the memo is keyed by
// (workspace, window) and one workspace holds several live window keys, so a
// blunt clear() would also throw away every OTHER tenant's fresh payload. The
// version rides in the key, so bumping it retires exactly this workspace's
// entries — every window at once — and the stale ones are reclaimed by the
// TTL/eviction pass already in `createTtlCache`.
const writeVersions = new Map<string, number>();

/** The current analytics write version for a workspace (0 until the first write).
 *  Part of the memo key, not of any payload. */
export function analyticsWriteVersion(workspaceId: string): number {
  return writeVersions.get(workspaceId) ?? 0;
}

/** Retire every memoized analytics payload for `workspaceId`. Called by the
 *  analytics write doors AFTER a successful store write, so the reload the editor
 *  fires re-aggregates instead of serving the figure the recruiter just replaced.
 *  Bounded by the tenant count — one small integer per workspace that has ever
 *  been written to, never per key axis. */
export function invalidateAnalyticsWorkspace(workspaceId: string): void {
  writeVersions.set(workspaceId, analyticsWriteVersion(workspaceId) + 1);
}

export type AnalyticsCache<T> = {
  /** Return the memoized payload for (workspace, window) if still fresh, else compute,
   *  store, and return it. */
  get(workspaceId: string, windowDays: number | null, compute: () => T): T;
  /** Drop all entries (test hook / manual flush). */
  clear(): void;
};

/** Build a TTL memo keyed by (workspace, window). Thin wrapper over the generic
 *  string-keyed core -- inheriting its bound -- so the /api/analytics route keeps
 *  its typed call shape. `ttlMs`/`now`/`maxEntries` are injectable so a test can
 *  drive expiry deterministically without wall-clock sleeps. */
export function createAnalyticsCache<T>(opts?: { ttlMs?: number; now?: () => number; maxEntries?: number }): AnalyticsCache<T> {
  const inner = createTtlCache<T>(opts);
  return {
    get(workspaceId, windowDays, compute) {
      // The write version is appended rather than folded into `analyticsCacheKey`
      // so that builder stays PURE (its keying test drives it directly). A bumped
      // version simply names a key nothing has stored yet, which is a miss.
      return inner.get(`${analyticsCacheKey(workspaceId, windowDays)}${SEP}v${analyticsWriteVersion(workspaceId)}`, compute);
    },
    clear() {
      inner.clear();
    },
  };
}
