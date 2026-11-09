// The pure half of entry-scoring.ts: WHICH entries the role-fit ranker may score.
// A leaf (type-only imports) so the filing core can ask the question without pulling
// the ranker's module graph into every route that files an application.

import type { PipelineEntry } from "./db/core";

/** The entry fields scoring reads (an AutomationEntry or a freshly filed PipelineEntry). */
export type ScorableEntry = Pick<
  PipelineEntry,
  "id" | "candidateId" | "candidateLabel" | "jobId" | "jobTitle" | "matchScore" | "intakeDegraded" | "workspaceId"
>;

/** Whether an entry is one the ranker can score at all: unscored, not a degraded
 *  intake (a stub has no profile to rank), with a candidate and a job. The "ds-"
 *  exclusion is a LEGACY carve-out: a synthetic "ds-<submissionId>" id has no
 *  `profiles` row, so the pool lookup can only miss (a promoted submission now carries
 *  a real profile id and passes). */
export function isScorableEntry(e: ScorableEntry): boolean {
  return e.matchScore == null && !e.intakeDegraded && !!e.candidateId && !!e.jobId && !e.candidateId.startsWith("ds-");
}

/** The post-filing hook's predicate: score right after filing only a FRESH entry
 *  (never a duplicate — its score, if any, is the original's), only a built filing
 *  (never a quick-apply/ATS stub, which the sweep skips by design too), and only an
 *  entry the ranker can score. */
export function shouldScoreAfterFiling(outcome: { kind: "created" | "duplicate"; entry: ScorableEntry }, stub: boolean): boolean {
  return outcome.kind === "created" && !stub && isScorableEntry(outcome.entry);
}
