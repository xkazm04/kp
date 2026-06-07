// The interview scorecard's DATA CONTRACT — one definition of the per-competency
// rating shape and the scorecard wrapper that the LLM synthesis emits, the
// pipeline stores (interview_sessions.scorecard_json), and every surface that
// renders an interview result reads. This shape used to be hand-mirrored in the
// transcript modal, the recruiter compare grid, the candidate drawer, the drawer
// result view and the Decisions review card — four-plus independent copies that
// drift apart silently the moment one adds a field or re-words a name.
//
// Pure types (no React, no node deps) so both client surfaces and server code
// (db.ts, the interview API) import the SAME declaration — exactly like
// interview-recommendation.ts single-sources the advance|hold|reject verdict.
//
// THE SCALE LIVES ELSEWHERE, ON PURPOSE. A rating runs 1..RATING_MAX on the fixed
// rubric, but RATING_MAX and the rating→percent/tone projection live in
// app/_lib/format.ts alongside scoreTone, so a scorecard rating maps onto the
// app-wide 0–100 score scale (and its strong/mid/weak colors) exactly like every
// other score. Re-gearing the rubric is a one-line edit there; this module owns
// only the shape.

import type { InterviewRecommendation } from "@/app/_lib/interview-recommendation";

/** One competency scored on the fixed interview rubric: a 1..RATING_MAX rating
 *  and the verbatim evidence quote behind it. `evidence` is absent on a
 *  not-assessed axis (and on the compact, ratings-only surfaces). */
export type ScorecardRating = {
  competency: string;
  rating: number;
  evidence?: string;
};

/** The structured interview scorecard: per-competency ratings, a one-line
 *  summary, and the canonical advance|hold|reject verdict. Every field is
 *  optional because a legacy row or a partial/failed synthesis can omit any of
 *  them — consumers guard each one before rendering. */
export type Scorecard = {
  ratings?: ScorecardRating[];
  summary?: string;
  recommendation?: InterviewRecommendation;
};
