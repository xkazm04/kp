// SCORING ONLY — the role-fit score for named pipeline entries, with no decision.
//
// The automation pass's pre-policy sweep (automation-pass.ts, AUTO1) and the filing
// core's post-filing hook (application-filing.ts) share this one encoding of "score
// these entries of one job with the deterministic recruiter_cli ranker and persist the
// score". It writes exactly two things per entry: `match_score` (compare-and-swap —
// only while it is still NULL, setEntryMatchScore) and the `scored` audit event that
// the sweep has always written beside it. It NEVER writes a stage, an approval, a
// proposal or a decision: advancing or holding a candidate stays the policy pass's,
// which runs later and simply finds the score already there.
//
// Keyless: the ranker is LLM-free by default (no --weights-llm, no --embeddings), so a
// workspace with no API key scores exactly like one with a key.

import { getJob } from "./db/jobs";
import { recordAutomationEvent, setEntryMatchScore } from "./db/pipeline";
import { isScorableEntry, type ScorableEntry } from "./entry-scoring-policy";
import { resolveCandidatePoolEntry } from "./candidate-pool";
import { PipelineError } from "./python-runner";
import { rankPoolForJob } from "./recruiter-run";
import { withSpawnLane } from "./llm-request-context";

type RankPayload = { candidates?: { candidateId?: string; result?: { total?: number } }[] };

/** The ranker — rankPoolForJob unless a test injects one (nothing then spawns Python). */
export type EntryRanker = (
  jobId: string,
  pool: NonNullable<ReturnType<typeof resolveCandidatePoolEntry>>[],
  job: ReturnType<typeof getJob>,
) => Promise<RankPayload>;

const defaultRanker: EntryRanker = (jobId, pool, job) => rankPoolForJob<RankPayload>(jobId, pool, job);

export { isScorableEntry, shouldScoreAfterFiling, type ScorableEntry } from "./entry-scoring-policy";

/** Score one job's entries. Returns whether a paid interpreter was ISSUED (the sweep's
 *  budget counts spawns, not iterations). Best-effort: a ranker failure is logged and
 *  the entries stay unscored, exactly as before — never thrown.
 *
 *  `dryRun` patches the in-memory snapshot only (the pass's preview); otherwise the
 *  score is persisted under the NULL-only compare-and-swap, and the snapshot is patched
 *  only when this write won — a concurrent writer's score is never clobbered and never
 *  double-logged. */
export async function scoreEntriesForJob(
  jobId: string,
  group: ScorableEntry[],
  opts: { dryRun?: boolean; rank?: EntryRanker; logPrefix?: string } = {},
): Promise<boolean> {
  const prefix = opts.logPrefix ?? "entry-scoring";
  let issued = false;
  try {
    const candidates = group
      // Each entry resolves within its OWN workspace — the global sweep spans tenants,
      // so a candidate must never resolve against another team's store.
      .map((e) => resolveCandidatePoolEntry(e.candidateId as string, e.candidateLabel, e.workspaceId))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    if (candidates.length === 0) return false;

    // Pass the DB job directly when it exists, so ingested (non-corpus) jobs score too —
    // same contract as the candidates route.
    const job = getJob(jobId);
    issued = true;
    const payload = await (opts.rank ?? defaultRanker)(jobId, candidates, job);
    const scoreById = new Map<string, number>();
    for (const row of payload.candidates ?? []) {
      const total = row.result?.total;
      if (row.candidateId && typeof total === "number" && Number.isFinite(total)) {
        scoreById.set(row.candidateId, Math.round(total));
      }
    }
    for (const e of group) {
      const score = scoreById.get(e.candidateId as string);
      if (score == null) continue;
      if (opts.dryRun) {
        e.matchScore = score;
      } else if (setEntryMatchScore(e.id, score, e.workspaceId)) {
        e.matchScore = score;
        recordAutomationEvent(e.id, "scored", `${score} vs ${e.jobTitle ?? jobId}`, e.workspaceId);
      }
    }
  } catch (error) {
    if (error instanceof PipelineError) {
      console.error(`[${prefix}] auto-score failed for job ${jobId}: ${error.message}`);
    } else {
      console.error(`[${prefix}] auto-score failed for job ${jobId}`, error);
    }
  }
  return issued;
}

/** Score one freshly filed entry, in the BACKGROUND admission lane: a candidate's
 *  response is not waiting on it, and it must not take a slot ahead of a recruiter's
 *  click (python-runner admission lanes; KP_PYTHON_BACKGROUND_WAIT_MS bounds the wait,
 *  and a refusal is the same logged, unscored outcome as any ranker failure). The
 *  later automation pass picks up whatever this did not score. */
export function scoreFiledEntry(entry: ScorableEntry, opts: { rank?: EntryRanker } = {}): Promise<boolean> {
  if (!isScorableEntry(entry)) return Promise.resolve(false);
  return withSpawnLane("background", () =>
    scoreEntriesForJob(entry.jobId as string, [{ ...entry }], { rank: opts.rank, logPrefix: "score-after-filing" }),
  );
}
