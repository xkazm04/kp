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
import { buildCohorts, mergeRubricRows, isUnrecognizedCohort, compareCsvRows, cellFlag, coverageFor, mustAsksOwed } from "./jobsCompareCohorts.ts";

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
      humanScorecards: [{ ratings: [{ competency: "Technical depth", rating: 5 }], recommendation: "advance" }],
    },
    {
      candidateLabel: "Grace",
      recommendation: "hold",
      ratings: [{ competency: "Technical depth", rating: 2 }],
      humanScorecards: [],
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
      humanScorecards: [],
    },
  ]);
  assert.deepEqual(rows[0], ["Technical depth", "", "", "hold"]);
  assert.deepEqual(rows[1], ["Communication", 3, "", "hold"], "an observed 3 is still a 3");
});

test("compareCsvRows: a PANEL exports every interviewer's rating in one cell, never just the latest save", () => {
  // Human scorecards are keyed by (interviewer, round). A spreadsheet cell holds one
  // value, so several records join in the grid's own order (newest first) — never
  // averaged (that would be a decision) and never reduced to whoever saved last.
  const rubric = [R("Technical depth"), R("Communication")];
  const rows = compareCsvRows(rubric, [
    {
      candidateLabel: "Ada",
      recommendation: null,
      ratings: [],
      humanScorecards: [
        { ratings: [{ competency: "Technical depth", rating: 2 }], recommendation: "hold" },
        { ratings: [{ competency: "Technical depth", rating: 5 }, { competency: "Communication", rating: 4 }], recommendation: "advance" },
      ],
    },
  ]);
  assert.deepEqual(rows[0], ["Technical depth", "", "2 / 5", "hold / advance"]);
  assert.deepEqual(rows[1], ["Communication", "", 4, "hold / advance"], "one rating stays a number");
});

// ---- the director's record on the grid (challenge-r07 voice-interview-api/B) -------

test("cellFlag: a real AI rating on a never-reached axis, and a sentinel on a covered one, are the disagreements", () => {
  assert.equal(cellFlag(4, "Designed the sharding plan and walked the failover.", "not_reached"), "rated_not_reached");
  assert.equal(cellFlag(3, "Not assessed in this interview.", "covered"), "sentinel_but_covered");
  // Agreeing pairs carry no flag.
  assert.equal(cellFlag(4, "Owned the migration end to end.", "covered"), null);
  assert.equal(cellFlag(3, "Not assessed in this interview.", "not_reached"), null);
  assert.equal(cellFlag(2, "Hesitant on trade-offs.", "asked"), null);
  assert.equal(cellFlag(4, "Real quote.", undefined), null, "no director record, no flag");
  assert.equal(cellFlag(undefined, undefined, "not_reached"), null, "no rating, nothing to disagree with");
});

test("coverageFor: case-insensitive axis lookup; undirected (null coverage) answers undefined", () => {
  const coverage = { byAxis: { system_design: "asked" as const }, mustAsksUnasked: null };
  assert.equal(coverageFor(coverage, "System_Design"), "asked");
  assert.equal(coverageFor(coverage, "ownership"), undefined);
  assert.equal(coverageFor(null, "system_design"), undefined);
});

test("mustAsksOwed: a count > 0 is a chip; 0 and the unknown null render none", () => {
  assert.equal(mustAsksOwed({ byAxis: {}, mustAsksUnasked: 2 }), 2);
  assert.equal(mustAsksOwed({ byAxis: {}, mustAsksUnasked: 0 }), null);
  assert.equal(mustAsksOwed({ byAxis: {}, mustAsksUnasked: null }), null, "no end_interview: no chip, not a 0");
  assert.equal(mustAsksOwed(null), null);
  assert.equal(mustAsksOwed(undefined), null);
});

test("compareCsvRows: an AI rating on a NOT-REACHED axis exports blank; a covered axis keeps its number", () => {
  const rubric = [R("system_design"), R("ownership")];
  const rows = compareCsvRows(rubric, [
    {
      candidateLabel: "Ada",
      recommendation: "advance",
      ratings: [
        { competency: "system_design", rating: 4, evidence: "Sounded confident." },
        { competency: "ownership", rating: 5, evidence: "Owned the migration." },
      ],
      humanScorecards: [{ ratings: [{ competency: "system_design", rating: 3 }], recommendation: "hold" }],
      coverage: { byAxis: { system_design: "not_reached", ownership: "covered" }, mustAsksUnasked: null },
    },
  ]);
  assert.deepEqual(rows[0], ["system_design", "", 3, "advance"], "the unreached AI 4 is blank; the human 3 stays");
  assert.deepEqual(rows[1], ["ownership", 5, "", "advance"]);
});
