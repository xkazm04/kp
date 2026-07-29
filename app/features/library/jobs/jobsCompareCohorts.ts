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
import type { ScorecardRating } from "@/app/_lib/interview-scorecard";

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
