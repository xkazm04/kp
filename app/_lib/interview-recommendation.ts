// The interview / screening VERDICT contract — the canonical
// `advance | hold | reject` vocabulary the LLM HR automation emits and that the
// whole pipeline branches on. This module is the single TS source of truth for
// the legal set, the fallback, and the validators; it is pure (no React, no node
// deps) so both client surfaces (the Badge, the transcript modal, the recruiter
// compare grid) and server code (automation-run, db, API routes) import it.
//
// WHERE THE VALUES COME FROM. The three tokens originate in the Python prompts +
// coerce guards (pipeline/jobfit/automation.py: `screen_candidate` /
// `interview_scorecard`, single-sourced there as `RECOMMENDATIONS`). They flow,
// untouched, through automation-run.ts into the Decisions queue, the interview
// transcript modal, and the compare grid. Until this module existed the set lived
// only as a literal inside a Python prompt string and bare `string`s on the TS
// side, so a misspelled or off-taxonomy verdict from the model slipped straight
// through to the badge and silently rendered a neutral default with no warning,
// and a new developer had no single place stating the legal values.
//
// FALLBACK = "hold". An unknown / empty / malformed verdict coerces to `hold`:
// the safe middle state. Never `advance` (which could auto-progress a candidate)
// and never `reject` (the fairness gate forbids a silent auto-reject) — `hold`
// routes the candidate to the human Decisions gate, which is exactly where an
// unrecognised model verdict belongs. This mirrors the Python coerce default.
//
// DRIFT. The branching literals (e.g. `route === "advance"`) necessarily live in
// each language, but the validation set + fallback are single-sourced per side
// (here for TS, `RECOMMENDATIONS`/`RECOMMENDATION_FALLBACK` for Python) and the
// cross-language contract is documented in docs/features/pipeline/README.md §2.5. The TS
// half is pinned by interview-recommendation.test.ts; the Python half by
// pipeline/jobfit/tests/test_automation.py.

/** The canonical, ordered set of interview/screening verdicts. */
export const INTERVIEW_RECOMMENDATIONS = ["advance", "hold", "reject"] as const;

/** advance | hold | reject — the scorecard / screening recommendation. */
export type InterviewRecommendation = (typeof INTERVIEW_RECOMMENDATIONS)[number];

/** The fallback verdict for any unknown / empty / malformed value. See the
 *  module header for why `hold` (not advance/reject) is the safe default. */
export const INTERVIEW_RECOMMENDATION_FALLBACK: InterviewRecommendation = "hold";

const REC_SET: ReadonlySet<string> = new Set(INTERVIEW_RECOMMENDATIONS);

/** Canonical form of a raw verdict: trimmed + lower-cased, so "Advance",
 *  " HOLD " and "Reject" all resolve onto the set. Non-strings → "". */
function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** True only for an exact (case-insensitive) member of the canonical set —
 *  the type guard used to detect model drift at a parse boundary. */
export function isInterviewRecommendation(value: unknown): value is InterviewRecommendation {
  return REC_SET.has(normalize(value));
}

/** Validate a raw (LLM-emitted or stored) verdict into the union, falling back
 *  to {@link INTERVIEW_RECOMMENDATION_FALLBACK} ("hold") for anything off-set.
 *  Use this at logic boundaries that must hold a definite verdict (branching,
 *  audit-event detail). The Badge deliberately does NOT use this — it surfaces
 *  the raw off-taxonomy value so a human notices drift rather than masking it. */
export function coerceInterviewRecommendation(value: unknown): InterviewRecommendation {
  const v = normalize(value);
  return REC_SET.has(v) ? (v as InterviewRecommendation) : INTERVIEW_RECOMMENDATION_FALLBACK;
}

// --- Screen route: the binary advance/hold gate Task 1 derives ---------------
// `screen_candidate` collapses (recommendation, confidence, early-career gate)
// into `result.route` ∈ {advance, hold} — a strict SUBSET of the verdicts that
// automation-run.ts reads to decide whether to auto-advance or queue for review.

/** The screen-route gate values — a subset of {@link INTERVIEW_RECOMMENDATIONS}. */
export const SCREEN_ROUTES = ["advance", "hold"] as const;
export type ScreenRoute = (typeof SCREEN_ROUTES)[number];

const ROUTE_SET: ReadonlySet<string> = new Set(SCREEN_ROUTES);

/** Validate a raw route value into {advance, hold}, falling back to `hold`
 *  (queue for the human gate) — never silently auto-advance on a bad value. */
export function coerceScreenRoute(value: unknown): ScreenRoute {
  const v = normalize(value);
  return ROUTE_SET.has(v) ? (v as ScreenRoute) : "hold";
}
