import { writeFile } from "node:fs/promises";
import path from "node:path";
import { candidateOutcomes, getJob, type CandidateOutcome } from "./db";
import { buildCandidatePool } from "./candidate-pool";
import { listJobStatuses } from "./job-ingest";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, spawnPython } from "./python-runner";
import { recordRediscoveryAlerts } from "./rediscovery-alert-store";

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

export type PriorOutcome = { kind: "rejected" | "closed" | "elsewhere"; label: string };

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
  const rejected = hist.find((h) => h.status === "rejected");
  if (rejected) return { kind: "rejected", label: `Rejected · ${role(rejected)}` };
  const closed = hist.find((h) => h.status === "closed" || h.status === "declined");
  if (closed) return { kind: "closed", label: `Closed · ${role(closed)}` };
  const elsewhere = hist.find((h) => h.jobId !== jobId && (h.status === "active" || h.stage === "Hired"));
  if (elsewhere) return { kind: "elsewhere", label: `${elsewhere.stage} · ${role(elsewhere)}` };
  return null;
}

/** Rank the pool against one job and return its silver medalists. Throws (with the
 *  CLI's message) on a ranking failure so callers choose how to surface it — the
 *  route 500s, the best-effort publish/sweep triggers swallow it. */
export async function rediscoverForJob(
  job: NonNullable<ReturnType<typeof getJob>>,
  opts: { signal?: AbortSignal } = {}
): Promise<RediscoverResult> {
  const pool = buildCandidatePool();
  if (pool.length === 0) return { rediscovered: [], skipped: [], more: 0 };

  let workdir: string | null = null;
  try {
    workdir = await createWorkdir();
    const inputPath = path.join(workdir, "recruiter.json");
    await writeFile(inputPath, JSON.stringify({ jobId: job.id, candidates: pool }), "utf-8");
    const jobPath = path.join(workdir, "job.json");
    await writeFile(jobPath, JSON.stringify(job), "utf-8");

    const { result } = spawnPython(
      ["-m", "pipeline.jobfit.recruiter_cli", "--input-json", inputPath, "--job-json", jobPath],
      { signal: opts.signal },
    );
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) {
      const err = parseStderrError(stderr, exitCode);
      throw new Error(err.message);
    }
    const ranked = parsePythonJson<{
      candidates: {
        candidateId: string;
        label: string;
        archetype?: string;
        koPassed: boolean;
        result?: { total?: number };
      }[];
      skipped?: { id: string; label: string; reason: string }[];
    }>(stdout, stderr);
    const outcomes = candidateOutcomes();

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
      .sort((a, b) => b.score - a.score);

    const shown = rediscovered.slice(0, REDISCOVER_LIMIT);
    return {
      rediscovered: shown,
      skipped: ranked.skipped ?? [],
      more: Math.max(0, rediscovered.length - shown.length),
    };
  } finally {
    if (workdir) await cleanupWorkdir(workdir);
  }
}

/** Rank a job and persist its silver medalists as standing alerts. Best-effort:
 *  a ranking failure is swallowed (returns 0) so it can never break the publish
 *  or sweep that calls it. */
export async function raiseRediscoveryAlertsForJob(
  jobId: string,
  opts: { signal?: AbortSignal } = {}
): Promise<number> {
  const job = getJob(jobId);
  if (!job) return 0;
  try {
    const { rediscovered } = await rediscoverForJob(job, opts);
    return recordRediscoveryAlerts(job.id, job.title, rediscovered);
  } catch {
    return 0;
  }
}

/** Sweep every published role and raise alerts — the "a strong candidate entered
 *  the pool" trigger, run on demand from the feed's Refresh (cheap: the free plan
 *  caps active roles, and the pool is shared so each rank is one CLI call).
 *  Returns the roles swept and the count of newly-surfaced silver medalists. */
export async function sweepRediscoveryAlerts(
  opts: { signal?: AbortSignal } = {}
): Promise<{ jobsSwept: number; newAlerts: number }> {
  const publishedIds = Object.entries(listJobStatuses())
    .filter(([, status]) => status === "published")
    .map(([jobId]) => jobId);
  let newAlerts = 0;
  for (const jobId of publishedIds) {
    if (opts.signal?.aborted) break;
    newAlerts += await raiseRediscoveryAlertsForJob(jobId, opts);
  }
  return { jobsSwept: publishedIds.length, newAlerts };
}
