// P1-1: the four-fifths (80%) adverse-impact rule — a ready protected-class
// fairness primitive (the platform itself collects no demographic data; this runs
// only on aggregate counts a recruiter supplies).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeAdverseImpact, parseGroupCounts, FOUR_FIFTHS, ADVERSE_IMPACT_MIN_COHORT } from "./adverse-impact.ts";

test("classic EEOC example: 80% vs 40% selection flags the lower group", () => {
  const r = computeAdverseImpact([
    { group: "A", selected: 80, total: 100 }, // rate 0.80 — reference
    { group: "B", selected: 40, total: 100 }, // rate 0.40 → ratio 0.50 < 0.8
  ]);
  assert.equal(r.referenceGroup, "A");
  assert.equal(r.anyAdverseImpact, true);
  const a = r.groups.find((g) => g.group === "A")!;
  const b = r.groups.find((g) => g.group === "B")!;
  assert.equal(a.isReference, true);
  assert.equal(a.impactRatio, 1);
  assert.equal(a.adverseImpact, false);
  assert.equal(b.impactRatio, 0.5);
  assert.equal(b.adverseImpact, true);
});

test("no adverse impact when the ratio is at/above four-fifths", () => {
  const r = computeAdverseImpact([
    { group: "A", selected: 50, total: 100 }, // 0.50 reference
    { group: "B", selected: 45, total: 100 }, // 0.45 → ratio 0.90
  ]);
  assert.equal(r.anyAdverseImpact, false);
  const b = r.groups.find((g) => g.group === "B")!;
  assert.equal(b.impactRatio, 0.9);
  assert.equal(b.adverseImpact, false);
  // exactly 0.8 is the boundary and must NOT flag (rule is "below" 80%).
  assert.ok(FOUR_FIFTHS === 0.8);
});

test("ratio exactly at the 0.8 boundary is not flagged", () => {
  const r = computeAdverseImpact([
    { group: "A", selected: 100, total: 100 }, // 1.0 reference
    { group: "B", selected: 80, total: 100 }, // 0.8 → ratio 0.8 (boundary)
  ]);
  const b = r.groups.find((g) => g.group === "B")!;
  assert.equal(b.impactRatio, 0.8);
  assert.equal(b.adverseImpact, false);
  assert.equal(r.anyAdverseImpact, false);
});

test("no applicants anywhere → no reference, nothing flagged", () => {
  const r = computeAdverseImpact([
    { group: "A", selected: 0, total: 0 },
    { group: "B", selected: 0, total: 0 },
  ]);
  assert.equal(r.referenceGroup, null);
  assert.equal(r.anyAdverseImpact, false);
  for (const g of r.groups) {
    assert.equal(g.impactRatio, null);
    assert.equal(g.adverseImpact, false);
  }
});

test("reference rate of 0 (nobody selected) yields null ratios, no flags", () => {
  const r = computeAdverseImpact([
    { group: "A", selected: 0, total: 50 },
    { group: "B", selected: 0, total: 50 },
  ]);
  assert.equal(r.referenceGroup, "A"); // first group with applicants
  assert.equal(r.anyAdverseImpact, false);
  for (const g of r.groups) assert.equal(g.impactRatio, null);
});

test("a group with no applicants is skipped as reference and never flagged", () => {
  const r = computeAdverseImpact([
    { group: "Empty", selected: 0, total: 0 },
    { group: "A", selected: 90, total: 100 }, // reference
    { group: "B", selected: 50, total: 100 }, // ratio 0.555 → flagged
  ]);
  assert.equal(r.referenceGroup, "A");
  const empty = r.groups.find((g) => g.group === "Empty")!;
  assert.equal(empty.impactRatio, null);
  assert.equal(empty.isReference, false);
  assert.equal(empty.adverseImpact, false);
  assert.equal(r.groups.find((g) => g.group === "B")!.adverseImpact, true);
});

test("bad data is clamped: selected > total cannot exceed a 100% rate", () => {
  const r = computeAdverseImpact([
    { group: "A", selected: 200, total: 100 }, // clamped to 100/100 = 1.0
    { group: "B", selected: -5, total: 100 }, // clamped to 0/100 = 0.0 → flagged
  ]);
  const a = r.groups.find((g) => g.group === "A")!;
  assert.equal(a.selected, 100);
  assert.equal(a.selectionRate, 1);
  const b = r.groups.find((g) => g.group === "B")!;
  assert.equal(b.selected, 0);
  assert.equal(b.impactRatio, 0);
  assert.equal(b.adverseImpact, true);
});

// bug-ui-scan 2026-07-09 (analytics-calibration-dashboards #2): the four-fifths rule had NO
// minimum-sample floor, so a 1-applicant group at 100% became the reference every other group
// was measured against, flipping a legally-loaded verdict. Its siblings DO gate on cohort size
// (MIN_CALIBRATION_OUTCOMES, SALARY_BENCHMARK_MIN_COHORT), so this was an inconsistency, not a
// design choice. "Insufficient sample" must be a THIRD state, never a quiet "no adverse impact".

const N = ADVERSE_IMPACT_MIN_COHORT;

test("a sub-floor group can never become the reference", () => {
  // The exact trap: one applicant, selected, 100% rate. Under the old code this anchored the
  // ratio and dragged a perfectly healthy 60%-vs-60% comparison below four-fifths.
  const r = computeAdverseImpact([
    { group: "tiny", selected: 1, total: 1 },
    { group: "a", selected: 60, total: 100 },
    { group: "b", selected: 60, total: 100 },
  ]);
  assert.equal(r.referenceGroup, "a", "the reference must be a group that clears the floor");
  const tiny = r.groups.find((g) => g.group === "tiny")!;
  assert.equal(tiny.reliable, false);
  assert.equal(tiny.isReference, false);
  assert.equal(tiny.impactRatio, null, "an unreliable rate is never turned into a ratio");
  assert.equal(tiny.adverseImpact, false);
  assert.equal(r.anyAdverseImpact, false, "two healthy equal groups are not adverse impact");
});

test("insufficient sample is a distinct state, not a clean bill of health", () => {
  const r = computeAdverseImpact([
    { group: "a", selected: 3, total: 5 },
    { group: "b", selected: 1, total: 4 },
  ]);
  assert.equal(r.reliable, false, "fewer than two groups clear the floor");
  // b's rate is 25% vs a's 60% -> ratio 0.42, well under four-fifths. It must NOT be flagged,
  // because the sample cannot support the finding...
  assert.equal(r.anyAdverseImpact, false);
  // ...and every group must advertise that its own rate is untrustworthy, so the UI can render
  // "insufficient sample" rather than a green "no adverse impact".
  assert.ok(r.groups.every((g) => !g.reliable && g.impactRatio === null));
});

test("a real four-fifths violation is still caught once both groups clear the floor", () => {
  const r = computeAdverseImpact([
    { group: "ref", selected: N, total: N }, // 100%
    { group: "low", selected: Math.floor(N * 0.5), total: N }, // 50% -> ratio 0.5 < 0.8
  ]);
  assert.equal(r.reliable, true);
  assert.equal(r.referenceGroup, "ref");
  const low = r.groups.find((g) => g.group === "low")!;
  assert.equal(low.reliable, true);
  assert.ok(low.impactRatio !== null && low.impactRatio < FOUR_FIFTHS);
  assert.equal(low.adverseImpact, true);
  assert.equal(r.anyAdverseImpact, true, "the floor must not suppress a genuine finding");
});

test("a group exactly at the floor is reliable; one below it is not", () => {
  const r = computeAdverseImpact([
    { group: "at", selected: 10, total: N },
    { group: "below", selected: 10, total: N - 1 },
  ]);
  assert.equal(r.groups.find((g) => g.group === "at")!.reliable, true);
  assert.equal(r.groups.find((g) => g.group === "below")!.reliable, false);
  assert.equal(r.reliable, false, "only one group clears the floor, so nothing can be measured");
});

// bug-scan 2026-08-21 (lib-compliance): the reference group was matched back by NAME, so a
// pasted DUPLICATE group name marked every row sharing that name `isReference` — and
// `adverseImpact` exempts the reference. A second "Women" row at a 0.25 ratio rendered as
// "reference" under a green verdict instead of being flagged.

test("a duplicate group name cannot exempt a second row from the flag", () => {
  const r = computeAdverseImpact([
    { group: "Women", selected: 80, total: 100 }, // 0.80 — the reference
    { group: "Women", selected: 20, total: 100 }, // 0.20 → ratio 0.25, must flag
    { group: "Men", selected: 80, total: 100 },
  ]);
  const [ref, dup] = r.groups;
  assert.equal(ref.isReference, true);
  assert.equal(dup.isReference, false, "only the row that IS the reference may be the reference");
  assert.equal(dup.impactRatio, 0.25);
  assert.equal(dup.adverseImpact, true);
  assert.equal(r.anyAdverseImpact, true, "a 0.25 ratio must not hide behind a shared group name");
});

// bug-ui-scan 2026-07-09 (screening-decisions-records #4): parseGroupCounts must make a
// malformed pasted row VISIBLE rather than silently dropping it. The reference group is
// "highest rate among whatever parsed", so quietly discarding a mistyped line can change the
// reference and flip a verdict on a legally-loaded fairness surface. The recruiter must see
// that a row was ignored, and on which line.

test("clean input: every row parses, nothing flagged malformed", () => {
  const p = parseGroupCounts("Women, 40, 100\nMen, 80, 100");
  assert.deepEqual(p.groups, [
    { group: "Women", selected: 40, total: 100 },
    { group: "Men", selected: 80, total: 100 },
  ]);
  assert.deepEqual(p.malformedRows, []);
  assert.equal(p.nonBlankRows, 2);
});

test("a row with too few fields is reported malformed, by its 1-based line number", () => {
  // The exact scenario in the finding: "Female, 12" has only two fields.
  const p = parseGroupCounts("Male, 80, 100\nFemale, 12\nOther, 5, 20");
  assert.deepEqual(p.groups, [
    { group: "Male", selected: 80, total: 100 },
    { group: "Other", selected: 5, total: 20 },
  ]);
  assert.deepEqual(p.malformedRows, [2], "line 2 must be surfaced, not silently dropped");
  assert.equal(p.nonBlankRows, 3, "the ignored row still counts toward what the recruiter pasted");
});

test("a non-numeric or empty count is malformed, not a fabricated 0", () => {
  const p = parseGroupCounts("A, x, 100\nB, , 50\nC, 3, 4");
  assert.deepEqual(p.groups, [{ group: "C", selected: 3, total: 4 }]);
  assert.deepEqual(p.malformedRows, [1, 2]);
});

test("an empty group name is malformed", () => {
  const p = parseGroupCounts(", 10, 20\nReal, 10, 20");
  assert.deepEqual(p.malformedRows, [1]);
  assert.deepEqual(p.groups, [{ group: "Real", selected: 10, total: 20 }]);
});

test("blank/whitespace lines are ignored — neither parsed nor counted malformed", () => {
  const p = parseGroupCounts("\nWomen, 40, 100\n   \nMen, 80, 100\n");
  assert.equal(p.groups.length, 2);
  assert.deepEqual(p.malformedRows, []);
  assert.equal(p.nonBlankRows, 2, "empty lines do not inflate the row count");
});

// bug-scan 2026-08-21 (lib-compliance): a row with MORE than three comma fields was
// accepted — the first three fields were kept and the rest silently discarded. A
// spreadsheet paste with thousands separators ("Women, 1,200, 5,000") therefore read as
// 1/200, produced no warning at all, and turned a real 0.50 four-fifths violation into a
// green "no group falls below the threshold" verdict.

test("a row with extra comma fields is malformed, not silently truncated", () => {
  const p = parseGroupCounts("Women, 1,200, 5,000\nMen, 2,400, 5,000");
  assert.deepEqual(p.groups, [], "a thousands-separated row must not parse as 1/200");
  assert.deepEqual(p.malformedRows, [1, 2]);
  assert.equal(p.nonBlankRows, 2);
  // The truth the old parse hid: 1200/5000 vs 2400/5000 is a 0.50 ratio.
  const truth = computeAdverseImpact([
    { group: "Women", selected: 1200, total: 5000 },
    { group: "Men", selected: 2400, total: 5000 },
  ]);
  assert.equal(truth.anyAdverseImpact, true);
});

test("a trailing comma is punctuation, not a fourth field", () => {
  const p = parseGroupCounts("Women, 40, 100,\nMen, 80, 100");
  assert.deepEqual(p.groups, [
    { group: "Women", selected: 40, total: 100 },
    { group: "Men", selected: 80, total: 100 },
  ]);
  assert.deepEqual(p.malformedRows, []);
});

test("dropping a malformed row can change the reference — so it must be visible", () => {
  // Pasted four groups; row 3 is mistyped. Silently computing on the three that parsed
  // would give a different picture than the recruiter believes they entered.
  const p = parseGroupCounts("A, 30, 50\nB, 20, 50\nBROKEN LINE\nC, 45, 50");
  assert.deepEqual(p.malformedRows, [3]);
  assert.equal(p.groups.length, 3);
  assert.equal(p.nonBlankRows, 4, "recruiter pasted 4 rows; the verdict runs on 3");
});
