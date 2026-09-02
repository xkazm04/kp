// ONE THREAD (gap 8) — five status axes, ONE tone vocabulary.
//
// A candidate's thread crosses five independent status axes on its way from a job
// description to a hiring decision:
//
//   jobs.status          draft | published | closed                (3)
//   assignment lifecycle intake … closed                          (10, devcase-orchestrator STAGES)
//   pipeline stage       workspace-composed board columns          (5 by default, editable)
//   interview status     created | in_progress | … | revoked       (5, interview_sessions)
//   submission status    received | evaluated                      (2, dev_submissions)
//
// Each one keeps its own LABELS — they name genuinely different things and
// collapsing them into one word list would be a lie. What they should NOT each own
// is a private colour scheme. Until this module they did: `JobStatusBadge` painted
// draft stone / closed amber, `DevCasesTable.stageChip` painted awaiting_approval
// amber / live moss / everything-else stone, `DevVoiceScreenPanel.STATUS_TONE`
// painted in_progress blue / failed coral, and the pipeline stage was not a chip at
// all. So "amber" meant *closed* on one screen, *waiting for you* on the next, and
// nothing on a third — the reader had to learn five palettes to read one thread.
//
// The fix is a tone LAYER, not a label layer. Every axis value declares which of
// five reading states it is in, and the shared StatusChip renders that state the
// same way everywhere:
//
//   neutral  nothing has happened here yet
//   active   the system is working on it; nobody is blocked
//   waiting  a PERSON has to act — the recruiter, or the candidate
//   done     it reached its successful end state
//   stopped  it ended without reaching that state (closed, failed, revoked)
//
// FALLBACK POLICY. Every resolver takes a raw string, because these values arrive
// from SQLite, from the Python engine, and from a workspace-editable stage axis —
// none of which TypeScript checks. An unrecognised value resolves to `neutral`,
// which is the honest render (`we do not know what state this is in`) rather than
// a guess that reads as a verdict. But the DECLARED values must never reach that
// branch: the maps below are `Record<AxisValue, StatusTone>`, so omitting one is a
// compile error, and `status-tone.test.ts` re-checks it at runtime for every axis
// AND pins each tuple to its producer. A tone table that silently defaults is the
// same failure the devcase vocabulary catalogs were hardened against.
//
// Pure by design — no React, no next-intl, no DB. The chip that renders these
// lives in app/_components/StatusChip.tsx; the labels stay in the four catalogs.

import { isInterviewRecommendation, type InterviewRecommendation } from "./interview-recommendation";
import { roleOf, type StageDef, type StageRole } from "./pipeline-stages";

/** The five reading states, in legend order (nothing-yet → running → blocked →
 *  finished → stopped short). The order is the legend's order, so it is declared
 *  once here rather than re-listed by the component. */
export const STATUS_TONES = ["neutral", "active", "waiting", "done", "stopped"] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

// ---- Axis 1: jobs.status ----------------------------------------------------

/** `jobs.status` (app/_lib/db/core.ts JobRow.status). NULL is a third state —
 *  a seeded/corpus job that was never published through the product — and is not
 *  in this tuple on purpose; see {@link jobStatusTone}. */
export const JOB_STATUSES = ["draft", "published", "closed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_TONE: Record<JobStatus, StatusTone> = {
  // Written but not sourcing yet — nothing has happened to it.
  draft: "neutral",
  // "Published" here means internal go-live (sourcing runs), not a job board.
  published: "active",
  closed: "stopped",
};

// ---- Axis 2: the assignment (dev case) lifecycle ----------------------------

/** The 10 stages `app/_lib/devcase-orchestrator.ts` can write. Pinned to that
 *  producer by status-tone.test.ts — the orchestrator is the only writer, so a
 *  stage it can set and this tuple cannot would render untoned. */
export const ASSIGNMENT_STAGES = [
  "intake",
  "analyzed",
  "designed",
  "awaiting_approval",
  "approved",
  "published",
  "collecting",
  "ranked",
  "promoted",
  "closed",
] as const;
export type AssignmentStage = (typeof ASSIGNMENT_STAGES)[number];

export const ASSIGNMENT_STAGE_TONE: Record<AssignmentStage, StatusTone> = {
  // Filed, nothing designed yet.
  intake: "neutral",
  // The engine is working: analyse → design → (gate) → approve → publish → collect
  // → rank. None of these ask anything of a person.
  analyzed: "active",
  designed: "active",
  // The ONE human gate in the lifecycle: a flagged design routes to the recruiter.
  awaiting_approval: "waiting",
  approved: "active",
  published: "active",
  collecting: "active",
  ranked: "active",
  // The lifecycle's success end state — `DevLifecycleRow` already calls this "done".
  promoted: "done",
  closed: "stopped",
};

// ---- Axis 3: the pipeline board stage --------------------------------------
//
// Toned by stage ROLE, never by stage NAME. Board columns are workspace-editable
// (Settings → Hiring composes them), so a workspace that renames "Interview" to
// "Tech round" must not lose its colour — which is exactly why pipeline-stages.ts
// separated id from label from role in the first place. Keying the tone off the
// role means a renamed, reordered or invented column is still readable.

export const PIPELINE_ROLE_TONE: Record<StageRole, StatusTone> = {
  // On the board but not yet looked at.
  entry: "neutral",
  // Work in flight — automated screening, an interview round, the scoring pass.
  screening: "active",
  interview: "active",
  scoring: "active",
  // An offer sits on a person: the recruiter drafting it, the candidate answering.
  offer: "waiting",
  terminal: "done",
  // A stage a workspace invented that maps to none of the product's semantics.
  // It participates in ordering and nothing else, so it carries no reading state.
  custom: "neutral",
};

// ---- Axis 4: the voice-interview session ------------------------------------

/** `interview_sessions.status` (core.ts:608, written by app/_lib/db/interviews.ts).
 *  Pinned to the four `devcase.voiceScreen.status` catalogs by the test — that
 *  catalog is what turns these into words, so the two must not drift. */
export const INTERVIEW_STATUSES = ["created", "in_progress", "completed", "failed", "revoked"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const INTERVIEW_STATUS_TONE: Record<InterviewStatus, StatusTone> = {
  // The link is live and nothing else happens until the CANDIDATE dials in. That
  // is a person the recruiter may need to chase, not a job running somewhere.
  created: "waiting",
  in_progress: "active",
  completed: "done",
  failed: "stopped",
  revoked: "stopped",
};

// ---- Axis 5: the work-sample submission -------------------------------------

/** `dev_submissions.status` — written 'received' on intake (db/devcase.ts) and
 *  flipped to 'evaluated' when the eval bundle lands (db/devcase.ts:1177). */
export const SUBMISSION_STATUSES = ["received", "evaluated"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SUBMISSION_STATUS_TONE: Record<SubmissionStatus, StatusTone> = {
  // Evaluation is orchestrator-driven, so a received submission is queued work,
  // not a task waiting on the reviewer.
  received: "active",
  evaluated: "done",
};

// ---- Axis 6: the interview / screening VERDICT ------------------------------
//
// The one axis that is a JUDGEMENT rather than a lifecycle position, and the last
// one still painting itself: `advance/hold/reject` had a private `REC_STYLE`
// class map copy-pasted into FOUR files (the drawer's interview-outcome card, the
// drawer's human scorecard, the schedule scorecard form, the jobs compare grid).
// Two of those copies had already drifted in weight, so the same verdict was a
// different pill twenty pixels apart inside one drawer.
//
// It reads through the SAME five tones as every other axis, because the reader's
// question is the same one: where did this thread get to?
//   advance → done     it cleared the round
//   hold    → waiting  a PERSON decides next (this is also the fallback verdict,
//                      see interview-recommendation.ts — "route to the human gate")
//   reject  → stopped  it ended without clearing
//
// TRADE-OFF, stated: `stopped` renders muted, not red (StatusChip's "STOPPED IS
// NOT RED" rule). A reject verdict therefore loses the coral it used to carry.
// That is the price of one legend instead of five palettes, and the chip still
// SAYS "reject" — colour was never the thing carrying that word. Badge's
// `interviewRecommendationToken` keeps the red treatment for the surfaces that
// render a verdict as a standalone badge rather than as a point on the thread.
export const RECOMMENDATION_TONE: Record<InterviewRecommendation, StatusTone> = {
  advance: "done",
  hold: "waiting",
  reject: "stopped",
};

/** The pixel echo of {@link RECOMMENDATION_TONE} for the two call sites that
 *  cannot render a `StatusChip` today: the schedule scorecard's verdict PICKER
 *  (a pressed button, not a status read-out) and the jobs compare grid (whose
 *  renderer is a cohort table outside the drawer). ONE table instead of four, so
 *  the verdict cannot fork again while those surfaces migrate to the chip.
 *  Tokens only — no raw shades — so both themes hold (design:check). */
export const RECOMMENDATION_CHIP_CLASS: Record<InterviewRecommendation, string> = {
  advance: "bg-moss/15 text-moss",
  hold: "bg-dial-amber/20 text-ink",
  reject: "bg-coral/10 text-coral",
};

// ---- Resolvers ---------------------------------------------------------------
//
// Each takes the raw stored string. `neutral` is the unknown-value answer; the
// declared values never reach it (Record exhaustiveness + the runtime test).

const isKey = <T extends string>(map: Record<T, StatusTone>, v: string): v is T => Object.hasOwn(map, v);

/** `jobs.status` → tone. NULL/absent is the seeded-corpus live job: it behaves as
 *  published (that is what `listJobStatuses` consumers assume), so it tones
 *  `active` rather than falling to neutral. */
export function jobStatusTone(status?: string | null): StatusTone {
  const v = (status ?? "").trim();
  if (!v) return JOB_STATUS_TONE.published;
  return isKey(JOB_STATUS_TONE, v) ? JOB_STATUS_TONE[v] : "neutral";
}

/** An assignment lifecycle stage → tone. */
export function assignmentStageTone(stage?: string | null): StatusTone {
  const v = (stage ?? "").trim();
  return isKey(ASSIGNMENT_STAGE_TONE, v) ? ASSIGNMENT_STAGE_TONE[v] : "neutral";
}

/** A board stage id → tone, via its role on `axis`. An id the axis does not
 *  declare (a retired column, a legacy row) has no role — `roleOf` answers null —
 *  and tones neutral, matching that module's own "guessing a role would let a rule
 *  fire on a candidate nobody has classified" rule. */
export function pipelineStageTone(stageId?: string | null, axis?: readonly StageDef[]): StatusTone {
  const role = roleOf((stageId ?? "").trim(), axis);
  return role ? PIPELINE_ROLE_TONE[role] : "neutral";
}

/** An `interview_sessions.status` → tone. */
export function interviewStatusTone(status?: string | null): StatusTone {
  const v = (status ?? "").trim();
  return isKey(INTERVIEW_STATUS_TONE, v) ? INTERVIEW_STATUS_TONE[v] : "neutral";
}

/** A `dev_submissions.status` → tone. */
export function submissionStatusTone(status?: string | null): StatusTone {
  const v = (status ?? "").trim();
  return isKey(SUBMISSION_STATUS_TONE, v) ? SUBMISSION_STATUS_TONE[v] : "neutral";
}

/** An interview/screening verdict → tone. Takes the RAW stored/model-emitted
 *  string on purpose (the same render-boundary rule Badge keeps): an off-taxonomy
 *  verdict tones `neutral` and the caller shows the raw word, rather than being
 *  coerced to `hold` and reading as a decision nobody made. */
export function recommendationTone(recommendation?: string | null): StatusTone {
  const v = (recommendation ?? "").trim().toLowerCase();
  return isInterviewRecommendation(v) ? RECOMMENDATION_TONE[v as InterviewRecommendation] : "neutral";
}
