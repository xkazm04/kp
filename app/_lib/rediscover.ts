import { candidateOutcomes, getJob, getJobWorkspace, type CandidateOutcome } from "./db";
import { buildCandidatePool } from "./candidate-pool";
import { listJobStatuses } from "./job-ingest";
import { rankPoolForJob } from "./recruiter-run";
import { recordRediscoveryAlerts } from "./rediscovery-alert-store";
import { priorDepthBoost, byPriorAwareRank } from "./rediscovery-rank";

// The pure relevance filter lives in an import-free sibling so it's testable under
// bare node --test; re-exported here as the canonical import site.
export { filterRelevantAlerts } from "./rediscovery-relevance";

// Talent rediscovery, factored out of the on-demand /api/jobs/[id]/rediscover
// route so the SAME ranking can power both the panel and the standing alert
// triggers (publish + pool-change sweep, idea-fdb45cd0). Rank the whole pool
// against one job, then surface "silver medalists" — people rejected/closed
// elsewhere (or parked in another role) who clear the bar for this one and aren't
// already in it.

// Minimum match total (0-100) a rediscovered candidate must clear. 55 mirrors
// matching.FIT_PROMISING_THRESHOLD — at/above "promising" fit.
export const SCORE_FLOOR = 55;
// Max rediscovered candidates returned (ranked, so top-N). `more` reports how many
// eligible were dropped so the cap never reads as "this is everyone".
export const REDISCOVER_LIMIT = 20;

export type PriorOutcome = {
  kind: "rejected" | "closed" | "elsewhere";
  /** Legacy English chip label (kept for the persisted feed + back-compat). The
   *  LOCALIZED disclosure is rebuilt on each surface from `kind`/`stage`/`depth`. */
  label: string;
  /** The prior entry's terminal PIPELINE_STAGES stage (e.g. "Interview") — the
   *  disclosed depth. Canonical when `depth > 0`, so it maps cleanly to enums.stage. */
  stage: string;
  /** The band-limited ordering boost this prior contributed (priorDepthBoost).
   *  0 for a shallow/day-one prior. `depth > 0` is the signal a surface uses to
   *  DISCLOSE the depth in its why-now rationale — the boost that influenced order. */
  depth: number;
};

export type Rediscovered = {
  candidateId: string;
  label: string;
  archetype: string;
  score: number;
  prior: PriorOutcome;
};

export type RediscoverResult = {
  rediscovered: Rediscovered[];
  skipped: { id: string; label: string; reason: string }[];
  more: number;
};

function pickPrior(hist: CandidateOutcome[], jobId: string): PriorOutcome | null {
  const role = (o: CandidateOutcome) => o.jobTitle ?? "another role";
  // The prior's terminal stage is already on the fetched outcome row — read it for
  // the transparent, band-limited depth boost (priorDepthBoost) + the disclosed
  // depth, WITHOUT a second query. `depth` drives ordering; `stage` the rationale.
  const make = (kind: PriorOutcome["kind"], label: string, o: CandidateOutcome): PriorOutcome => ({
    kind,
    label,
    stage: o.stage,
    depth: priorDepthBoost(o.stage),
  });
  const rejected = hist.find((h) => h.status === "rejected");
  if (rejected) return make("rejected", `Rejected · ${role(rejected)}`, rejected);
  // `role_closed` (the role was filled/closed under them, JOB2) and `declined` both make
  // strong re-engagement targets — they cleared the bar, so resurface them as "closed"
  // silver medalists. (Pre-JOB2 this read `status === "closed"`, a value the taxonomy
  // never produced, so role-closed candidates were silently never rediscovered.)
  const closed = hist.find((h) => h.status === "role_closed" || h.status === "declined");
  if (closed) return make("closed", `Closed · ${role(closed)}`, closed);
  const elsewhere = hist.find((h) => h.jobId !== jobId && (h.status === "active" || h.stage === "Hired"));
  // An `elsewhere` prior is a LIVE entry, not a terminal one — the depth boost (and
  // its "got as far as X last time" disclosure) is about how far a silver medalist's
  // FINISHED run advanced, so a currently-active candidate takes no boost: their
  // stage would inflate ordering for someone who may not even be available.
  if (elsewhere) return { ...make("elsewhere", `${elsewhere.stage} · ${role(elsewhere)}`, elsewhere), depth: 0 };
  return null;
}

/** Rank the pool against one job and return its silver medalists. Throws (with the
 *  CLI's message) on a ranking failure so callers choose how to surface it — the
 *  route 500s, the best-effort publish/sweep triggers swallow it. */
export async function rediscoverForJob(
  job: NonNullable<ReturnType<typeof getJob>>,
  opts: { signal?: AbortSignal; workspaceId?: string } = {}
): Promise<RediscoverResult> {
  // Workspace-scoped pool: the on-demand route + publish thread their request's
  // currentWorkspace(); the background sweep leaves it at the default tenant
  // (its current behavior — a per-tenant sweep is a separate feature).
  const { entries: pool } = buildCandidatePool(opts.workspaceId);
  if (pool.length === 0) return { rediscovered: [], skipped: [], more: 0 };

  const ranked = await rankPoolForJob<{
    candidates: {
      candidateId: string;
      label: string;
      archetype?: string;
      koPassed: boolean;
      result?: { total?: number };
    }[];
    skipped?: { id: string; label: string; reason: string }[];
  }>(job.id, pool, job, { signal: opts.signal });
  // Prior-outcome labels (pickPrior) MUST read the SAME tenant the pool was built
  // for — an unscoped read defaults to the single workspace, so in any other team
  // the "silver medalist" priors would be mislabeled from (or missing against)
  // another tenant's pipeline history. Mirrors buildCandidatePool(opts.workspaceId).
  const outcomes = candidateOutcomes(opts.workspaceId);

  const rediscovered = ranked.candidates
    .filter((row) => row.koPassed && Math.round(row.result?.total ?? 0) >= SCORE_FLOOR)
    .map((row): Rediscovered | null => {
      const hist = outcomes.get(row.candidateId) ?? [];
      // Already in THIS role's pipeline → not a rediscovery.
      if (hist.some((h) => h.jobId === job.id && h.status === "active")) return null;
      const prior = pickPrior(hist, job.id);
      if (!prior) return null;
      return {
        candidateId: row.candidateId,
        label: row.label,
        archetype: row.archetype ?? "bau",
        score: Math.round(row.result?.total ?? 0),
        prior,
      };
    })
    .filter((r): r is Rediscovered => r !== null)
    // Prior-aware rank: honest base score is still the PRIMARY key, refined by a
    // band-limited prior-depth boost (byPriorAwareRank) so a final-round near-miss
    // floats above a day-one screen-out within the same score band — never across
    // it. Admission (SCORE_FLOOR) already happened above on the HONEST score, so the
    // boost only REORDERS the admitted set; the displayed `score` stays the honest
    // base. At the REDISCOVER_LIMIT cut this means a deeper prior just below the cut
    // may edge out a shallower one just above it — but only when their base scores
    // are within the band, so the cut never admits anyone a real tier stronger got
    // bumped for.
    .sort((a, b) =>
      byPriorAwareRank({ score: a.score, boost: a.prior.depth }, { score: b.score, boost: b.prior.depth })
    );

  const shown = rediscovered.slice(0, REDISCOVER_LIMIT);
  return {
    rediscovered: shown,
    skipped: ranked.skipped ?? [],
    more: Math.max(0, rediscovered.length - shown.length),
  };
}

/** Rank a job and persist its silver medalists as standing alerts. Best-effort:
 *  a ranking failure is swallowed (returns 0) so it can never break the publish
 *  or sweep that calls it. */
export async function raiseRediscoveryAlertsForJob(
  jobId: string,
  opts: { signal?: AbortSignal; workspaceId?: string } = {}
): Promise<number> {
  const job = getJob(jobId);
  if (!job) return 0;
  // Thread the owning tenant so BOTH the outcome lookup (inside rediscoverForJob)
  // and the persisted alert rows land in the job's workspace — never always the
  // default. The on-demand route/publish pass their session workspace explicitly;
  // the pool-change sweep leaves it undefined, so fall back to the job's OWN
  // workspace (getJobWorkspace → DEFAULT for a seeded corpus job that has no single
  // owner). A fully per-tenant background sweep is a separate feature (NON-GOAL).
  const workspaceId = opts.workspaceId ?? getJobWorkspace(jobId);
  try {
    const { rediscovered } = await rediscoverForJob(job, { ...opts, workspaceId });
    return recordRediscoveryAlerts(job.id, job.title, rediscovered, workspaceId);
  } catch {
    return 0;
  }
}

// ---- Sweep bounds (bug-ui-scan #2) ------------------------------------------
//
// sweepRediscoveryAlerts used to fan out one recruiter_cli subprocess per
// published role, sequentially, with NO cap, NO per-subprocess timeout, and NO
// ceiling — the code only ASSUMED "the free plan caps active roles". A paid/seeded
// workspace with dozens of open roles turned one Refresh click into a minutes-long
// request that could exhaust the box and blow the serverless timeout mid-sweep. So
// bound it three ways: a worker-pool CONCURRENCY cap, a per-role wall-clock TIMEOUT
// (aborts a hung CLI), and an overall CEILING on roles processed per sweep (with a
// loud log when it truncates — never a silent cap).

/** Max roles processed in one sweep. Excess is deferred to the next Refresh and
 *  logged — the request cost can never scale linearly with the catalog size. */
export const SWEEP_MAX_ROLES = 25;
/** Worker-pool size: at most this many recruiter_cli children run at once, so the
 *  sweep's peak CPU/subprocess load is bounded regardless of the role count. */
export const SWEEP_CONCURRENCY = 3;
/** Per-role wall-clock bound. A role whose ranking outruns this is aborted (its
 *  CLI child SIGKILLed via the signal) and contributes 0 — one slow/hung role can
 *  never stall the whole sweep. Well under a serverless request budget. */
export const SWEEP_JOB_TIMEOUT_MS = 60_000;

/** Run `worker` over `items` with at most `concurrency` in flight at once — a
 *  minimal fixed-size worker pool (no dependency). Workers pull from a shared
 *  cursor, so a slow item doesn't hold a slot the others need. Pure/injectable so
 *  the concurrency bound is unit-testable without real subprocesses. */
export async function runWithPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runOne = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, runOne);
  await Promise.all(workers);
}

/** raiseRediscoveryAlertsForJob wrapped in a per-role wall-clock TIMEOUT (bundled
 *  with the caller's abort signal). On timeout the combined signal aborts, which
 *  rankPoolForJob threads into spawnPython → the CLI child is SIGKILLed and the
 *  ranking rejects; raiseRediscoveryAlertsForJob already swallows that and returns
 *  0, so a hung role degrades to "surfaced nothing", never a stalled sweep. The
 *  `raise` dependency is injectable so the timeout is testable without a real CLI. */
export async function raiseForJobBounded(
  jobId: string,
  parentSignal: AbortSignal | undefined,
  opts: {
    timeoutMs?: number;
    workspaceId?: string;
    raise?: (jobId: string, o: { signal?: AbortSignal; workspaceId?: string }) => Promise<number>;
  } = {}
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? SWEEP_JOB_TIMEOUT_MS;
  const raise = opts.raise ?? raiseRediscoveryAlertsForJob;
  const ac = new AbortController();
  const onParentAbort = () => ac.abort();
  if (parentSignal) {
    if (parentSignal.aborted) ac.abort();
    else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await raise(jobId, { signal: ac.signal, workspaceId: opts.workspaceId });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

export type SweepDeps = {
  /** The published-role ids to sweep, most-relevant first (the caller truncates). */
  listPublishedJobIds: () => string[];
  /** Rank ONE role and persist its silver-medalist alerts, returning how many were
   *  newly surfaced. Bounded by a per-role timeout + the caller's abort signal. */
  raiseForJob: (jobId: string, signal: AbortSignal | undefined) => Promise<number>;
};

// The on-demand sweep is triggered from a specific team's Refresh, so it must run
// on THAT team's catalog (rediscovery-alerts #1): list only the caller's published
// roles and rank/persist against the caller's workspace. Omitting workspaceId keeps
// the prior default-tenant behavior for any non-request caller.
function defaultSweepDeps(workspaceId?: string): SweepDeps {
  return {
    listPublishedJobIds: () =>
      Object.entries(listJobStatuses(workspaceId))
        .filter(([, status]) => status === "published")
        .map(([jobId]) => jobId),
    raiseForJob: (jobId, signal) => raiseForJobBounded(jobId, signal, { workspaceId }),
  };
}

/** Sweep published roles and raise silver-medalist alerts — the "a strong
 *  candidate entered the pool" trigger, run on demand from the feed's Refresh.
 *  BOUNDED (bug-ui-scan #2): at most SWEEP_MAX_ROLES roles per sweep (excess
 *  deferred + logged), a SWEEP_CONCURRENCY worker pool, and a per-role timeout —
 *  so the request cost can never scale linearly with the catalog. `deps` is
 *  injectable for tests. Returns the roles actually swept, the newly-surfaced
 *  count, and how many roles were deferred (`truncated`). */
export async function sweepRediscoveryAlerts(
  opts: { signal?: AbortSignal; workspaceId?: string } = {},
  deps: SweepDeps = defaultSweepDeps(opts.workspaceId)
): Promise<{ jobsSwept: number; newAlerts: number; truncated: number }> {
  const publishedIds = deps.listPublishedJobIds();
  const roles = publishedIds.slice(0, SWEEP_MAX_ROLES);
  const truncated = publishedIds.length - roles.length;
  if (truncated > 0) {
    console.warn(
      `[rediscovery] sweep truncated: ${publishedIds.length} published roles exceed the ${SWEEP_MAX_ROLES}-role/sweep ceiling — processing ${roles.length}, deferring ${truncated} to the next Refresh.`
    );
  }
  let newAlerts = 0;
  await runWithPool(roles, SWEEP_CONCURRENCY, async (jobId) => {
    if (opts.signal?.aborted) return; // client hung up — stop scheduling new work
    // Read-AFTER-await, then a synchronous += — `newAlerts += await …` would read
    // newAlerts BEFORE suspending and write back a stale sum, so concurrent workers
    // would lose increments (JS compound-assign reads the LHS before the RHS).
    const added = await deps.raiseForJob(jobId, opts.signal);
    newAlerts += added;
  });
  return { jobsSwept: roles.length, newAlerts, truncated };
}
