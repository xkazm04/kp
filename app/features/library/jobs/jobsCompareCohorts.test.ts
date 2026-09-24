// Pins the pure cohort/rubric-row logic behind the recruiter interview compare
// grid (compareCohorts.ts), extracted from CompareInterviews.tsx for these two
// bug-ui-scan-2026-07-09 (interview-simulation-comparison) fixes:
//   #1 — an off-taxonomy scoringModel that maps to NO rubric is FLAGGED
//        (isUnrecognizedCohort) instead of rendering a header above an empty body.
//   #2 — a rating whose competency isn't in the current rubric (rubric-version
//        drift) surfaces as an off-rubric ROW instead of silently blanking to "—".
// Runner: node --test with the repo's test:alias loader (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCohorts, mergeRubricRows, isUnrecognizedCohort, compareCsvRows } from "./jobsCompareCohorts.ts";

const R = (competency: string, description = "") => ({ competency, description });

test("buildCohorts: known cohorts first, off-taxonomy models after (first-seen); blank scoringModel folds to experienced", () => {
  const rubrics = { experienced: [R("Technical depth")], early_career: [R("Coachability")] };
  const candidates = [
    { scoringModel: "early_career", ratings: [] },
    { scoringModel: "senior-legacy", ratings: [] }, // off-taxonomy (hyphen/legacy value)
    { scoringModel: "experienced", ratings: [] },
    { scoringModel: "", ratings: [] }, // blank -> experienced
  ];
  const cohorts = buildCohorts(candidates, rubrics);
  assert.deepEqual(
    cohorts.map((c) => c.model),
    ["experienced", "early_career", "senior-legacy"]
  );
  assert.equal(cohorts[0].candidates.length, 2, "blank scoringModel joins the experienced cohort");
  assert.deepEqual(cohorts[2].rubric, [], "an off-taxonomy model resolves to no rubric");
});

test("isUnrecognizedCohort: an empty rubric (off-taxonomy scoringModel) is flagged (#1)", () => {
  assert.equal(isUnrecognizedCohort([]), true);
  assert.equal(isUnrecognizedCohort([R("Technical depth")]), false);
});

test("mergeRubricRows: a rating under an axis absent from the current rubric surfaces as an off-rubric row, not a dropped score (#2)", () => {
  // Pre-fix the grid iterated `rubric.map(...)` ONLY (2 rows) — a rating stored
  // under a renamed/old axis matched nothing and rendered "—". The helper appends
  // it, flagged, so the real score is visible.
  const rubric = [R("Technical depth"), R("Communication")];
  const candidates = [
    { ratings: [{ competency: "Technical depth", rating: 4 }, { competency: "Legacy axis v1", rating: 5 }] },
  ];
  const rows = mergeRubricRows(rubric, candidates);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.competency), ["Technical depth", "Communication"]);
  assert.ok(rows.slice(0, 2).every((r) => !r.offRubric), "current rubric axes come first, not flagged");
  const extra = rows.find((r) => r.competency === "Legacy axis v1");
  assert.ok(extra && extra.offRubric, "the off-rubric rating is surfaced and flagged");
  assert.equal(rows.length, 3);
});

test("mergeRubricRows: extras dedup case-insensitively; a case-variant of a rubric axis adds no extra row", () => {
  const rubric = [R("Communication")];
  const candidates = [
    { ratings: [{ competency: "communication", rating: 3 }] }, // case variant of the rubric axis -> no extra
    { ratings: [{ competency: "Old Axis", rating: 4 }] },
    { ratings: [{ competency: "old axis", rating: 2 }] }, // dup of the above (case-insensitive)
  ];
  const rows = mergeRubricRows(rubric, candidates);
  assert.equal(rows.length, 2, "Communication + a single off-rubric Old Axis");
  assert.equal(rows.filter((r) => r.offRubric).length, 1);
});

test("mergeRubricRows: an unrecognized cohort (empty rubric) still surfaces every rated axis rather than nothing (#1/#2)", () => {
  const rows = mergeRubricRows([], [{ ratings: [{ competency: "Some axis", rating: 3 }] }]);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].offRubric);
});

test("compareCsvRows: two candidates produce aligned columns; a missing human rating is blank, not 0", () => {
  const rubric = [R("Technical depth"), R("Communication")];
  const candidates = [
    {
      candidateLabel: "Ada",
      recommendation: "advance",
      ratings: [
        { competency: "Technical depth", rating: 4 },
        { competency: "Communication", rating: 3 },
      ],
      humanScorecard: { ratings: [{ competency: "Technical depth", rating: 5 }], recommendation: "advance" },
    },
    {
      candidateLabel: "Grace",
      recommendation: "hold",
      ratings: [{ competency: "Technical depth", rating: 2 }],
      humanScorecard: null,
    },
  ];
  const rows = compareCsvRows(rubric, candidates);
  assert.equal(rows[0].length, 7, "competency + 3 cells per candidate");
  assert.deepEqual(rows[0], ["Technical depth", 4, 5, "advance", 2, "", "hold"]);
  assert.deepEqual(rows[1], ["Communication", 3, "", "advance", "", "", "hold"]);
  assert.ok(!rows.flat().includes(0), "a missing rating must not fabricate 0");
});

test("compareCsvRows: a NOT-ASSESSED axis exports blank, not the synthesis's mid-scale 3", () => {
  // The AI synthesis writes an untouched competency as a real 3 with "Not assessed…"
  // evidence. In a spreadsheet the caveat cannot travel with the number, so the number
  // must not travel either — a genuine observed 3 still does.
  const rubric = [R("Technical depth"), R("Communication")];
  const rows = compareCsvRows(rubric, [
    {
      candidateLabel: "Ada",
      recommendation: "hold",
      ratings: [
        { competency: "Technical depth", rating: 3, evidence: "Not assessed (auto-synthesis unavailable)." },
        { competency: "Communication", rating: 3, evidence: "She walked through the rollback herself." },
      ],
      humanScorecard: null,
    },
  ]);
  assert.deepEqual(rows[0], ["Technical depth", "", "", "hold"]);
  assert.deepEqual(rows[1], ["Communication", 3, "", "hold"], "an observed 3 is still a 3");
});
