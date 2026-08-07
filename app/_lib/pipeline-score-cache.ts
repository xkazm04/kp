// Short-TTL per-workspace memo for the canonical-score resolution behind
// GET /api/pipeline. Every board poll (every 30s, per open board) re-ran
// withCanonicalScores(listPipeline(ws), ws), and the expensive half of that is the
// analyses query buildFreshestFits() runs — recomputed on every tick even when the
// analyses didn't change.
//
// This memoizes ONLY that fit map (the DB-dependent input), per workspace, behind a
// small TTL — the SAME analytics-cache.ts idiom (injectable clock, TTL-only
// invalidation, workspace-keyed so a map can never cross tenants). The entries
// themselves are NOT cached, so a pipeline write still reflects on the very next
// poll; only the fit lookup is served from the memo within the TTL. The payload
// shape is byte-identical to calling withCanonicalScores directly.
//
// The TTL is deliberately small (seconds): a freshly-saved analysis surfaces its new
// canonical score within one TTL, well inside a recruiter's read cadence, so no
// write-path invalidation is needed.

import { createAnalyticsCache, type AnalyticsCache } from "./analytics-cache";
import { buildFreshestFits, withCanonicalScores, type CanonicalScoreFields } from "./match-score-resolve";
import type { AnalysisFit } from "./match-score";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";

const DEFAULT_TTL_MS = 15_000;

type Entryish = { candidateLabel: string; jobId: string | null; matchScore: number | null };

export type CachedScoreResolver = {
  /** Stamp canonical scores using a per-workspace, TTL-memoized fit map. Identical
   *  output to withCanonicalScores(entries, ws) — only the analyses query is cached. */
  withCanonicalScores<T extends Entryish>(entries: T[], workspaceId?: string): (T & CanonicalScoreFields)[];
  /** Drop the memo (test hook / manual flush). */
  clear(): void;
};

/** Build a resolver over an injectable clock/TTL, so a test can drive expiry
 *  deterministically (mirrors createAnalyticsCache's seam). */
export function createCachedScoreResolver(opts?: { ttlMs?: number; now?: () => number }): CachedScoreResolver {
  const cache: AnalyticsCache<Map<string, AnalysisFit>> = createAnalyticsCache<Map<string, AnalysisFit>>({
    ttlMs: opts?.ttlMs ?? DEFAULT_TTL_MS,
    now: opts?.now,
  });
  return {
    withCanonicalScores<T extends Entryish>(entries: T[], workspaceId: string = DEFAULT_WORKSPACE_ID) {
      // windowDays is `null` here — scores have no window axis, only a workspace one;
      // the (workspace, null) key keeps two tenants' fit maps strictly separate.
      const freshest = cache.get(workspaceId, null, () => buildFreshestFits(workspaceId));
      return withCanonicalScores(entries, workspaceId, freshest);
    },
    clear() {
      cache.clear();
    },
  };
}

// The process-wide resolver the route uses (default clock + TTL).
const resolver = createCachedScoreResolver();

/** withCanonicalScores with the per-workspace fit map served from a short-TTL memo. */
export function withCanonicalScoresCached<T extends Entryish>(
  entries: T[],
  workspaceId?: string
): (T & CanonicalScoreFields)[] {
  return resolver.withCanonicalScores(entries, workspaceId);
}
