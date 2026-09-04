// Short-TTL per-workspace memo for the canonical-score resolution behind
// GET /api/pipeline. Every board poll (every 30s, per open board) re-ran
// withCanonicalScores(listPipeline(ws), ws), and the expensive half of that is the
// analyses query buildFreshestFits() runs — recomputed on every tick even when the
// analyses didn't change.
//
// This memoizes ONLY that fit map (the DB-dependent input), per workspace, behind a
// small TTL — the SAME ttl-cache.ts idiom (injectable clock, TTL-only
// invalidation, workspace-keyed so a map can never cross tenants). The entries
// themselves are NOT cached, so a pipeline write still reflects on the very next
// poll; only the fit lookup is served from the memo within the TTL. The payload
// shape is byte-identical to calling withCanonicalScores directly.
//
// The TTL is deliberately small (seconds): a freshly-saved analysis surfaces its new
// canonical score within one TTL, well inside a recruiter's read cadence, so no
// write-path invalidation is needed.

// The GENERIC core, not `createAnalyticsCache`. This memo was built on the analytics
// wrapper for its shape, and inherited its key: `invalidateAnalyticsWorkspace` bumps a
// per-workspace write version that rides in that key, so saving a conversion goal or a
// channel spend figure on the Insights tab retired the canonical-score map for the whole
// workspace and the next board poll paid a full buildFreshestFits() it had no reason to.
// Analytics settings and canonical scores share no data; they no longer share a key.
import { createTtlCache, KEY_SEP, type TtlCache } from "./ttl-cache";
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

/** The memo key: the workspace, and nothing else — scores have no window, source or
 *  filter axis. Workspace-first (the only field), so two tenants' fit maps are strictly
 *  separate. The trailing marker keeps the key namespaced if this cache ever gains a
 *  second axis. Exported for the keying test. */
export function scoreCacheKey(workspaceId: string): string {
  return `${workspaceId}${KEY_SEP}fits`;
}

/** Build a resolver over an injectable clock/TTL, so a test can drive expiry
 *  deterministically (mirrors the analytics memo's seam). */
export function createCachedScoreResolver(opts?: { ttlMs?: number; now?: () => number }): CachedScoreResolver {
  const cache: TtlCache<Map<string, AnalysisFit>> = createTtlCache<Map<string, AnalysisFit>>({
    ttlMs: opts?.ttlMs ?? DEFAULT_TTL_MS,
    now: opts?.now,
  });
  return {
    withCanonicalScores<T extends Entryish>(entries: T[], workspaceId: string = DEFAULT_WORKSPACE_ID) {
      const freshest = cache.get(scoreCacheKey(workspaceId), () => buildFreshestFits(workspaceId));
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
