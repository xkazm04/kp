// Pure cohort / rubric-row logic for the recruiter interview compare grid,
// extracted from CompareInterviews.tsx so it is unit-testable under `node --test`
// (which can't load the .tsx). Two bug-ui-scan fixes live here:
//   #1 — detect a cohort whose scoringModel maps to NO rubric (an off-taxonomy /
//        LLM-drifted / legacy value) so the grid can SAY so instead of rendering a
//        name+verdict header above an empty, ratingless body — indistinguishable
//        from a genuinely un-scored candidate at the hire-decision surface.
//   #2 — surface ratings whose competency isn't in the CURRENT rubric (a candidate
//        scored months earlier under a renamed/revised axis) as explicit off-rubric
//        rows, instead of letting the exact-name join silently blank them to "—".
// See bug-ui-scan-2026-07-09 (interview-simulation-comparison #1, #2).
import { isNotAssessedRating, type ScorecardRating } from "@/app/_lib/interview-scorecard";
// TYPE-only: the coverage derivation is server-side (it value-imports the director);
// the grid receives its result on the compare payload.
import type { AxisCoverage, AxisCoverageState } from "@/app/_lib/interview-axis-coverage";

export type RubricComp = { competency: string; description: string; anchors?: Record<string, string> };

// Candidates are comparable WITHIN a cohort, not across — an experienced hire's
// track-record axes and a student's potential constructs are different rubrics.
// Known cohorts render first, in this order; any other scoringModel follows in
// first-seen order. Cohort display labels live in the catalog (jobs.compare.cohort.*).
export const COHORT_ORDER = ["experienced", "early_career"];

type WithModel = { scoringModel: string };
type WithRatings = { ratings: ScorecardRating[] };

/** Group candidates into ordered cohorts by scoringModel and pair each with its
 *  rubric (empty when the scoringModel isn't a known rubric key — see
 *  isUnrecognizedCohort). A blank/absent scoringModel is treated as
 *  'experienced', matching the DB-boundary default in interviewedForJob. */
export function buildCohorts<C extends WithModel>(
  candidates: C[],
  rubrics: Record<string, RubricComp[]>
): { model: string; rubric: RubricComp[]; candidates: C[] }[] {
  const present = Array.from(new Set(candidates.map((c) => c.scoringModel || "experienced")));
  const models = [
    ...COHORT_ORDER.filter((m) => present.includes(m)),
    ...present.filter((m) => !COHORT_ORDER.includes(m)),
  ];
  return models.map((model) => ({
    model,
    rubric: rubrics[model] ?? [],
    candidates: candidates.filter((c) => (c.scoringModel || "experienced") === model),
  }));
}

export type CohortRow = {
  competency: string;
  description: string;
  anchors?: Record<string, string>;
  // True for a row NOT in the cohort's current rubric that at least one candidate
  // carries a rating for (rubric-version drift, or an unrecognized scoringModel).
  // The UI renders it flagged, so a real score is visible AND marked as scored on
  // a different axis set — never silently dropped to "—" (interview-simulation-comparison #2).
  offRubric: boolean;
};

/** The rows a cohort table should render: the cohort's rubric axes first, then
 *  any competency a candidate was actually scored on that the current rubric
 *  doesn't contain (matched case-insensitively, the same way the grid's ratingOf
 *  joins), appended and flagged offRubric. Dedups extras case-insensitively,
 *  preserving first-seen order and original casing. */
export function mergeRubricRows(rubric: RubricComp[], candidates: WithRatings[]): CohortRow[] {
  const rows: CohortRow[] = rubric.map((c) => ({
    competency: c.competency,
    description: c.description,
    anchors: c.anchors,
    offRubric: false,
  }));
  const known = new Set(rubric.map((c) => c.competency.toLowerCase()));
  const seen = new Set<string>();
  for (const cand of candidates) {
    for (const r of cand.ratings ?? []) {
      const key = r.competency?.toLowerCase();
      if (!key || known.has(key) || seen.has(key)) continue;
      seen.add(key);
      rows.push({ competency: r.competency, description: "", offRubric: true });
    }
  }
  return rows;
}

/** True when a cohort's scoringModel resolves to no rubric at all — an
 *  off-taxonomy / drifted value whose candidates would otherwise show a name +
 *  verdict header above zero rating rows, indistinguishable from an un-scored
 *  candidate (interview-simulation-comparison #1). */
export function isUnrecognizedCohort(rubric: RubricComp[]): boolean {
  return rubric.length === 0;
}

type CsvRating = { competency: string; rating: number; evidence?: string };

export type CompareCsvCandidate = {
  candidateLabel?: string | null;
  recommendation?: string | null;
  ratings: CsvRating[];
  /** Every interviewer's record, newest first (the grid's own order). */
  humanScorecards?: { ratings?: CsvRating[]; recommendation?: string | null }[];
  coverage?: AxisCoverage | null;
};

/** One cell: a real rating number, or blank when that side was never scored.
 *  Never `?? 0` — a missing human (or AI) rating is not a zero.
 *
 *  A NOT-ASSESSED axis is blank too, for the same reason the grid stopped colouring
 *  one: the AI synthesis stores a competency the interview never reached as a real 3
 *  carrying "Not assessed…" evidence, and exporting that 3 hands a spreadsheet — where
 *  the caveat cannot follow it — a middling score nobody observed. */
function csvRating(ratings: CsvRating[] | undefined, competency: string, state?: AxisCoverageState): number | "" {
  const hit = ratings?.find((r) => r.competency.toLowerCase() === competency.toLowerCase());
  if (typeof hit?.rating !== "number") return "";
  // The director's record outranks the model's self-report: an AI number on an axis
  // no attempt ever began is blanked exactly like the sentinel (the grid flags it;
  // a spreadsheet cannot carry the flag, so it must not carry the number).
  if (state === "not_reached") return "";
  return isNotAssessedRating(hit.rating, hit.evidence) ? "" : hit.rating;
}

/** The human cell for one axis across a PANEL of scorecards: one rating stays a
 *  number; several join in record order ("2 / 5"). Never averaged — combining
 *  independent assessors is a decision, not an export — and never reduced to whoever
 *  saved last, which is the defect the per-interviewer list exists to end. */
function csvHumanRating(cards: CompareCsvCandidate["humanScorecards"], competency: string): number | string {
  const vals = (cards ?? []).map((c) => csvRating(c.ratings, competency)).filter((v): v is number => v !== "");
  return vals.length === 0 ? "" : vals.length === 1 ? vals[0] : vals.join(" / ");
}

/** The human verdicts across the panel, in record order, blank when none carries one. */
function csvHumanRecommendation(cards: CompareCsvCandidate["humanScorecards"]): string {
  return (cards ?? []).map((c) => c.recommendation).filter((r): r is string => Boolean(r)).join(" / ");
}

/** Data rows of the compare grid: competency × (AI, human, recommendation) per
 *  candidate. Header is the caller's (localized). Missing ratings stay blank. */
export function compareCsvRows(rubric: RubricComp[], candidates: CompareCsvCandidate[]): (string | number)[][] {
  const axes = mergeRubricRows(rubric, candidates);
  return axes.map((axis) => {
    const cells: (string | number)[] = [axis.competency];
    for (const c of candidates) {
      cells.push(
        csvRating(c.ratings, axis.competency, coverageFor(c.coverage, axis.competency)),
        csvHumanRating(c.humanScorecards, axis.competency),
        c.recommendation ?? csvHumanRecommendation(c.humanScorecards)
      );
    }
    return cells;
  });
}

// ---- the director's record on the grid (challenge-r07 voice-interview-api/B) -------

/** The director's state for one axis (case-insensitive, the grid's own join), or
 *  undefined when the session was undirected or the axis carries no record. */
export function coverageFor(coverage: AxisCoverage | null | undefined, competency: string): AxisCoverageState | undefined {
  if (!coverage) return undefined;
  const lower = competency.toLowerCase();
  for (const [axis, state] of Object.entries(coverage.byAxis)) if (axis.toLowerCase() === lower) return state;
  return undefined;
}

/** Where the AI rating and the director's record DISAGREE — the case the recruiter
 *  could not see: a real rating on an axis no attempt ever began (absence of
 *  evidence dressed as a score), or the not-assessed sentinel on an axis the director
 *  accepted as covered on a verified quote. Agreeing pairs, and cells with no record
 *  or no rating, carry no flag. */
export type CoverageCellFlag = "rated_not_reached" | "sentinel_but_covered";
export function cellFlag(
  rating: number | null | undefined,
  evidence: string | null | undefined,
  state: AxisCoverageState | undefined,
): CoverageCellFlag | null {
  if (typeof rating !== "number" || !state) return null;
  const sentinel = isNotAssessedRating(rating, evidence);
  if (state === "not_reached" && !sentinel) return "rated_not_reached";
  if (state === "covered" && sentinel) return "sentinel_but_covered";
  return null;
}

/** The "n must-asks owed" chip count: a positive count only. 0 owes nothing and the
 *  unknown `null` (no end_interview on record) is not a 0, so neither renders a chip. */
export function mustAsksOwed(coverage: AxisCoverage | null | undefined): number | null {
  const n = coverage?.mustAsksUnasked;
  return typeof n === "number" && n > 0 ? n : null;
}
