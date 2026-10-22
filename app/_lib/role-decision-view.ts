// CX S45 - the role decision view: for ONE role, every candidate still in play, each
// with the facts a person weighs before they shortlist or decide - the match score and
// who produced it, the work-sample result and how it was graded, the evidence ladder's
// three rungs in summary, and the interview scorecards. The S46 per-role overview reads
// this; the Decisions role level already shows its work-sample part beside the fit.
//
// PURE: the loader (role-decision-view-server.ts) does every store read and hands the
// facts in. Nothing here blends the parts into one number - the ladder's rule (ADR 0027
// S3: descriptive only, never a folded score) holds for the whole view.
//
// HONEST ABSENCE: every part that has nothing to show is an explicit null beside a
// reason code (`not_sent`, `not_evaluated`, `no_scorecard`, ...), never a 0. A person
// never sent a work sample and one who scored 0 on it are different facts.
//
// WHERE THE TRANSFER SCORE COMES FROM: `dev_submissions.transfer_score`, through the
// entry's submission link. The promote's `screening_review` card carries a COPY of it in
// `confidence`, taken once at promote time; the submission is the source of truth and
// is what a re-evaluation rewrites, so the card is not read here.

import { evaluationCurrency, type EvaluationCurrency } from "./devcase-cohort-rank";
import { evidenceLadder, type DebriefReadoutInput, type EmptyCause, type WitnessKind } from "./evidence-ladder/ladder";
import { isNotAssessedRating } from "./interview-scorecard";
import type { MatchScoreProvenance } from "./match-score";
import { isTerminalEntryStatus } from "./pipeline-status";

/** Which candidates the view holds: status `active` (not rejected, declined, rematched
 *  or role_closed - pipeline-status.ts) AND not standing on the axis's terminal stage
 *  (Hired keeps status `active`, so the status alone would keep a hire in play). */
export const ROLE_VIEW_ACTIVE_RULE = "status_active_not_terminal_stage" as const;

export function activeForDecision(entry: { status: string; stage: string }, terminalStages: ReadonlySet<string>): boolean {
  return !isTerminalEntryStatus(entry.status) && !terminalStages.has(entry.stage);
}

// ---- inputs (what the loader read) ------------------------------------------------

type ScorecardLike = { ratings?: unknown; authorLabel?: unknown; savedAt?: unknown };

export type RoleViewEntryInput = {
  id: string;
  candidateLabel: string;
  stage: string;
  status: string;
  canonicalScore: number | null;
  scoreProvenance: MatchScoreProvenance | null;
  /** The assignment this entry was sent or came out of (devCaseIdForEntry). */
  caseId: string | null;
  /** The submission promoted onto this entry (submissionIdForEntry). */
  submissionId: string | null;
};

/** The entry's submission as the loader found it IN THIS WORKSPACE (null when the link
 *  names nothing the workspace owns - a foreign team's submission reads as absent). */
export type RoleViewSubmissionInput = {
  transferScore: number | null;
  evaluation: unknown;
  debrief: DebriefReadoutInput;
};

export type RoleViewFacts = {
  entry: RoleViewEntryInput;
  submission: RoleViewSubmissionInput | null;
  humanScorecards: readonly ScorecardLike[];
  /** The latest AI interview's scorecard, or null when no AI interview ran. */
  aiScorecard: ScorecardLike | null;
};

// ---- output ----------------------------------------------------------------------

export type RoleViewMatch =
  | { score: number; provenance: MatchScoreProvenance | null; reason: null }
  | { score: null; provenance: null; reason: "not_scored" };

export type WorkSampleAbsence = "not_sent" | "not_submitted" | "not_evaluated";

export type RoleViewLadder = {
  watched: { acts: number; witness: WitnessKind; reason: null } | { acts: null; witness: null; reason: EmptyCause };
  defended: { supported: number; total: number; reason: null } | { supported: null; total: null; reason: EmptyCause };
  /** Was the evaluation held for authorship, and has a person cleared it. */
  hold: "held" | "cleared" | "none";
  quoted: { rated: true; count: number; reason: null } | { rated: false; count: null; reason: EmptyCause };
};

export type RoleViewWorkSample = {
  /** The transfer score, from `dev_submissions.transfer_score`; null with `reason`. */
  transferScore: number | null;
  reason: WorkSampleAbsence | null;
  /** Where `transferScore` was read from (always the submission; see the header). */
  source: "submission" | null;
  /** The instrument: `template` is the keyless deterministic grader, `graded` a model's. */
  grading: EvaluationCurrency | null;
  /** The evidence ladder in summary; null only when no work sample was sent. */
  ladder: RoleViewLadder | null;
};

export type RoleViewRating = { average: number; count: number; reason: null } | { average: null; count: number; reason: "no_scorecard" | "no_ratings" };

export type RoleViewInterview = {
  /** The interviewers' scorecards: `count` records, `average` over every assessed rating. */
  human: RoleViewRating;
  /** The AI interview's own scorecard (count is 0 or 1). */
  ai: RoleViewRating;
  /** The rating scale both averages are on (1..scale). */
  scale: number;
};

export type RoleViewCandidate = {
  entryId: string;
  candidateLabel: string;
  stage: string;
  match: RoleViewMatch;
  workSample: RoleViewWorkSample;
  interview: RoleViewInterview;
};

// ---- assembly ----------------------------------------------------------------------

function matchOf(e: RoleViewEntryInput): RoleViewMatch {
  return typeof e.canonicalScore === "number" && Number.isFinite(e.canonicalScore)
    ? { score: e.canonicalScore, provenance: e.scoreProvenance, reason: null }
    : { score: null, provenance: null, reason: "not_scored" };
}

/** Mean of the assessed ratings on these cards, to one decimal. A not-assessed sentinel
 *  (the AI's mid-scale 3 with placeholder evidence) is not a rating and is skipped. */
function ratingOf(cards: readonly ScorecardLike[]): RoleViewRating {
  if (cards.length === 0) return { average: null, count: 0, reason: "no_scorecard" };
  const values: number[] = [];
  for (const card of cards) {
    const ratings = Array.isArray(card.ratings) ? (card.ratings as Array<{ rating?: unknown; evidence?: unknown }>) : [];
    for (const r of ratings) {
      if (!r || typeof r.rating !== "number" || !Number.isFinite(r.rating)) continue;
      if (isNotAssessedRating(r.rating, typeof r.evidence === "string" ? r.evidence : null)) continue;
      values.push(r.rating);
    }
  }
  if (values.length === 0) return { average: null, count: cards.length, reason: "no_ratings" };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { average: Math.round(mean * 10) / 10, count: cards.length, reason: null };
}

function ladderOf(f: RoleViewFacts, sent: boolean): RoleViewLadder {
  const evaluation = f.submission?.evaluation ?? null;
  const ladder = evidenceLadder({
    submission: sent,
    evaluation,
    debrief: f.submission?.debrief ?? null,
    humanScorecards: f.humanScorecards,
    aiInterview: f.aiScorecard,
  });
  const evaluated = evaluation !== null && typeof evaluation === "object";
  const debrief = f.submission?.debrief ?? null;
  // The hold is read straight off the debrief state, not off the DEFENDED rung: the rung
  // is empty until a debrief is recorded, and a held submission is held before that.
  const hold: RoleViewLadder["hold"] = !evaluated || !debrief
    ? "none"
    : typeof debrief.clearedBy === "string" && debrief.clearedBy
      ? "cleared"
      : debrief.held === true
        ? "held"
        : "none";
  const w = ladder.watched;
  const d = ladder.defended;
  const q = ladder.quoted;
  return {
    watched: w.state === "evidence" ? { acts: w.acts, witness: w.witness, reason: null } : { acts: null, witness: null, reason: w.cause },
    defended: d.state === "evidence" ? { supported: d.tally.supported, total: d.tally.total, reason: null } : { supported: null, total: null, reason: d.cause },
    hold,
    quoted: q.state === "evidence" ? { rated: true, count: q.ratings.length, reason: null } : { rated: false, count: null, reason: q.cause },
  };
}

function workSampleOf(f: RoleViewFacts): RoleViewWorkSample {
  const sent = f.entry.caseId !== null || f.entry.submissionId !== null;
  if (!sent) return { transferScore: null, reason: "not_sent", source: null, grading: null, ladder: null };
  const ladder = ladderOf(f, true);
  if (!f.submission) return { transferScore: null, reason: "not_submitted", source: null, grading: null, ladder };
  const score = f.submission.transferScore;
  const evaluated = f.submission.evaluation !== null && typeof f.submission.evaluation === "object";
  if (typeof score !== "number" || !Number.isFinite(score) || !evaluated) {
    return { transferScore: null, reason: "not_evaluated", source: null, grading: null, ladder };
  }
  return { transferScore: Math.round(score), reason: null, source: "submission", grading: evaluationCurrency(f.submission.evaluation), ladder };
}

/** One candidate's view. */
export function roleViewCandidate(f: RoleViewFacts, scale: number): RoleViewCandidate {
  return {
    entryId: f.entry.id,
    candidateLabel: f.entry.candidateLabel,
    stage: f.entry.stage,
    match: matchOf(f.entry),
    workSample: workSampleOf(f),
    interview: { human: ratingOf(f.humanScorecards), ai: ratingOf(f.aiScorecard ? [f.aiScorecard] : []), scale },
  };
}

export type RoleDecisionView = {
  jobId: string;
  /** The rule `candidates` was filtered by (see activeForDecision). */
  active: typeof ROLE_VIEW_ACTIVE_RULE;
  candidates: RoleViewCandidate[];
};

/** The role's view: active candidates only, in the order the loader read them. */
export function assembleRoleDecisionView(
  jobId: string,
  facts: readonly RoleViewFacts[],
  terminalStages: ReadonlySet<string>,
  scale: number,
): RoleDecisionView {
  return {
    jobId,
    active: ROLE_VIEW_ACTIVE_RULE,
    candidates: facts.filter((f) => activeForDecision(f.entry, terminalStages)).map((f) => roleViewCandidate(f, scale)),
  };
}
