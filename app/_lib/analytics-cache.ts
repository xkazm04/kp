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

import { createTtlCache, KEY_SEP, optionalKeyField, type TtlCache } from "./ttl-cache";

// The generic TTL core now lives in ttl-cache.ts (see its header for why: a memo
// built on THIS module inherited the analytics write version and was retired by an
// analytics settings write it had nothing to do with). Re-exported here so the
// analytics + calibration + decision-records routes keep importing their cache from
// the module whose keys they use.
export { createTtlCache };
export type { TtlCache };

// The joiner for this module’s composite keys — the shared NUL separator.
const SEP = KEY_SEP;

/** The memo key: workspace first, then the window (null = all-time). Two workspaces —
 *  or two windows within one workspace — never collide. Exposed for the keying test. */
export function analyticsCacheKey(workspaceId: string, windowDays: number | null): string {
  return `${workspaceId}${SEP}${windowDays == null ? "all" : windowDays}`;
}

// ── Per-route key builders ───────────────────────────────────────
// All NUL-joined for the same reason as analyticsCacheKey: workspace ids, the
// source token, role-family names and candidate refs are NUL-free, so the
// concatenation is collision-free. An ABSENT optional field is marked by
// `optionalKeyField` (ttl-cache.ts), whose marker no real value can forge.
const field = optionalKeyField;

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
