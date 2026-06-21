// P1-1: the four-fifths (80%) adverse-impact rule — a ready protected-class
// fairness primitive (the platform itself collects no demographic data; this runs
// only on aggregate counts a recruiter supplies).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeAdverseImpact, FOUR_FIFTHS } from "./adverse-impact.ts";

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
