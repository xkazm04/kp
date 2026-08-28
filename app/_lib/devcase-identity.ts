// ONE THREAD — the single owner of "which job / which candidate / which assignment"
// for everything the dev-case path writes onto the hiring pipeline.
//
// THE PROBLEM THIS REPLACES. promoteSubmission and the case-sourcing seed used to
// MINT identities instead of joining them: `jobId: "dc-<caseId>"` and
// `candidateId: "ds-<submissionId>"`. Both look like ids and neither is one. The
// consequences were all the same defect wearing different clothes:
//
//   * a candidate who came in through the JD's real opening (`jd-<slug>`) and then
//     did the assignment existed TWICE on the board, under two job ids;
//   * Matrix and Match could not rank the assignment half at all — there is no
//     `profiles` row behind a "ds-" id, so the candidate pool never contained them;
//   * the assignment's entry never pointed back at the JD it was cut for, so a
//     recruiter on the Jobs surface could not see that the role had a work sample.
//
// THE RULE. The pipeline's own identities are the pipeline's identities: an entry's
// `jobId` is the real job, its `candidateId` is a real profile. What the prefixes
// used to encode now travels in its own two columns — `dev_case_id` and
// `dev_submission_id` (db/core.ts) — which is what lets both facts be true at once.
//
// BACKWARD COMPATIBILITY IS THE OTHER HALF. Every entry written before this change
// carries the meaning in the prefix and NOTHING in the columns, so the two resolvers
// below read the column first and fall back to parsing the prefix. That fallback is
// permanent, not a migration window: those rows are real hires' history, we cannot
// know which profile a "ds-" id was meant to be, and inventing one retroactively
// would be exactly the fabrication this module exists to stop.
//
// This module is deliberately PURE (no db, no i18n): db/pipeline.ts imports the
// legacy prefix from it, so anything heavier here would be a cycle.

import type { PipelineEntry } from "./db/core";

/** The prefix a pre-ONE-THREAD entry's `jobId` carried instead of a real job id. */
export const LEGACY_DEV_CASE_JOB_PREFIX = "dc-";

/** The prefix a pre-ONE-THREAD entry's `candidateId` carried instead of a profile id. */
export const LEGACY_SUBMISSION_CANDIDATE_PREFIX = "ds-";

/** The board column a promoted submission lands in.
 *
 *  A NAMED CONSTANT, not a step toward removing the literal. `docs/features/pipeline/
 *  README.md` lists devcase-run among the sites that are "still name-coupled, and
 *  deliberately left": they are CREATION DEFAULTS on the shipped five-column axis, and
 *  a workspace that renamed its columns gets a candidate filed in the wrong column
 *  rather than a wrong number. Naming it here makes the coupling greppable and gives
 *  the eventual per-workspace resolution one place to happen. */
export const DEVCASE_PROMOTE_STAGE = "Screened";

/** The role family a promoted/sourced entry falls back to when NOTHING states one.
 *
 *  Last resort only — `roleFamilyForCase` below prefers the linked job's family, then
 *  the need's. It stays the historical literal rather than becoming role-families.ts's
 *  honest `DEFAULT_ROLE_FAMILY` ("general_professional", "never assume software")
 *  because every assignment the design pipeline can currently produce IS a software
 *  work sample; demoting it is a product decision about non-software assignments, not
 *  a bug fix, and it would change how unlinked cases are matched. Recorded as a
 *  follow-up rather than made silently here. */
export const DEVCASE_FALLBACK_ROLE_FAMILY = "software_engineering";

/** The synthetic job id an assignment with NO linked job still has to use.
 *
 *  Not a fallback we are happy about — it is the same minted id as before, kept for
 *  the one state that genuinely has no job: a case cut from a JD whose best-effort
 *  ingest never produced a `jd-<slug>` row (or no JD at all). The alternative, a NULL
 *  job on a board that groups by job, would drop the candidate off every job view. */
export function syntheticCaseJobId(caseId: string | null | undefined): string {
  return `${LEGACY_DEV_CASE_JOB_PREFIX}${caseId ?? "case"}`;
}

/** The minimum a caller has to know about an assignment to file its candidates. */
export type CaseJobSource = {
  /** The case's own id (`dc_…`), or null when the posting names no case. */
  caseId: string | null;
  /** `dev_cases.job_id` — the real opening, or null when the JD was never sourced. */
  jobId: string | null;
  /** The linked job's title (joined at read by db/devcase.ts), when there is one. */
  jobTitle: string | null;
  /** The assignment's own role title, the fallback label for an unlinked case. */
  roleTitle: string | null;
};

export type CaseJobIdentity = {
  /** What to write as the entry's `jobId`. */
  jobId: string;
  /** What to write as the entry's `jobTitle`. */
  jobTitle: string;
  /** True when `jobId` is a REAL opening; false when it is the synthetic fallback. */
  linked: boolean;
};

/** The job identity a dev-case entry should carry.
 *
 *  The whole point of the milestone in four lines: when the assignment knows its
 *  opening, its candidates land on THAT opening's board alongside everyone who
 *  applied to it directly. When it does not — and NULL is a real, documented state,
 *  because JD → Job ingest is best-effort — the synthetic id is used and `linked` says
 *  so, so callers can record which of the two happened instead of leaving a reader to
 *  guess from the shape of an id. */
export function caseJobIdentity(source: CaseJobSource, fallbackTitle?: string | null): CaseJobIdentity {
  const jobId = (source.jobId ?? "").trim();
  const title = (source.jobTitle ?? source.roleTitle ?? fallbackTitle ?? "").trim();
  if (jobId) return { jobId, jobTitle: title || jobId, linked: true };
  return { jobId: syntheticCaseJobId(source.caseId), jobTitle: title || "Dev case", linked: false };
}

/** The role family a dev-case entry should carry: stated by the opening, else stated
 *  by the need the assignment was cut from, else the documented last-resort literal.
 *  `isKnown` is left to the caller — role-families.ts owns the vocabulary and this
 *  module stays pure — but blank/whitespace values never win over a real one. */
export function roleFamilyForCase(jobRoleFamily?: string | null, needRoleFamily?: string | null): string {
  const fromJob = (jobRoleFamily ?? "").trim();
  if (fromJob) return fromJob;
  const fromNeed = (needRoleFamily ?? "").trim();
  if (fromNeed) return fromNeed;
  return DEVCASE_FALLBACK_ROLE_FAMILY;
}

/** The subset of a pipeline entry these resolvers read. Widened from `PipelineEntry`
 *  so a caller holding a partial row (an automation projection, a test fixture) can
 *  still resolve — every field is one the board's own type already carries. */
export type IdentityCarrier = Pick<PipelineEntry, "jobId" | "candidateId"> &
  Partial<Pick<PipelineEntry, "devCaseId" | "devSubmissionId">>;

/** The assignment behind an entry, or null when it did not come from one.
 *
 *  Column first, `dc-` prefix second. Replaces the direct `devCaseIdFromJobId(entry.jobId)`
 *  reads at every consumer (the case-grounded interview brief, its candidate-safe
 *  projection, the planned-minutes estimate, the observed-skill mint) — those broke
 *  the moment the entry started carrying a real `jd-<slug>` job, which is precisely
 *  what this milestone made it do. */
export function devCaseIdForEntry(entry: IdentityCarrier | null | undefined): string | null {
  if (!entry) return null;
  const linked = (entry.devCaseId ?? "").trim();
  if (linked) return linked;
  const jobId = entry.jobId;
  return jobId && jobId.startsWith(LEGACY_DEV_CASE_JOB_PREFIX)
    ? jobId.slice(LEGACY_DEV_CASE_JOB_PREFIX.length) || null
    : null;
}

/** The evaluated submission behind an entry, or null when it was not promoted from one.
 *  Column first, `ds-` prefix second — same contract as devCaseIdForEntry. */
export function submissionIdForEntry(entry: IdentityCarrier | null | undefined): string | null {
  if (!entry) return null;
  const linked = (entry.devSubmissionId ?? "").trim();
  if (linked) return linked;
  const candidateId = entry.candidateId;
  return candidateId && candidateId.startsWith(LEGACY_SUBMISSION_CANDIDATE_PREFIX)
    ? candidateId.slice(LEGACY_SUBMISSION_CANDIDATE_PREFIX.length) || null
    : null;
}
