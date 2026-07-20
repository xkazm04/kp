// Pins the lead-separation contract (UAT 2026-07-20, L1-TOM-GEF-01).
//
// The group eval crowns `candidates[0]` on the bare point estimate and seals that
// crown into the decision record, while the confidence band that measures how thin
// each candidate's evidence is stays display-only. A 2-point lead between two WIDE
// bands is noise; a 2-point lead between two TIGHT bands is real. This helper makes
// that distinction explicit so the crown, the summary and the sealed record can
// state it instead of implying a separation the numbers do not support.
//
// It deliberately does NOT reorder anyone — ranking stays the honest score order.
// It only answers "is this lead statistically separated from the runner-up?".
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { leadSeparation, separationNote, type BandedCandidate } from "./group-eval-separation.ts";

const banded = (score: number, low: number, high: number): BandedCandidate => ({
  score,
  confidence: { low, high },
});

test("separated when the lead's band floor clears the runner-up's band ceiling", () => {
  // 80 [76-84] vs 60 [56-64] — no overlap, the lead is genuinely ahead.
  assert.equal(leadSeparation(banded(80, 76, 84), banded(60, 56, 64)), "separated");
});

test("overlapping when the bands intersect, even with a clear point-estimate gap", () => {
  // 72 [60-84] vs 68 [56-80] — 4 points apart on paper, but the bands overlap
  // heavily: this is the case the crown used to present as a decisive win.
  assert.equal(leadSeparation(banded(72, 60, 84), banded(68, 56, 80)), "overlapping");
});

test("touching bands are overlapping, not separated (boundary is inclusive)", () => {
  // low === high is still not a gap — refuse to claim separation at the boundary.
  assert.equal(leadSeparation(banded(70, 64, 76), banded(60, 54, 64)), "overlapping");
});

test("unknown when either side carries no band — never guess a separation", () => {
  assert.equal(leadSeparation({ score: 80 }, banded(60, 56, 64)), "unknown");
  assert.equal(leadSeparation(banded(80, 76, 84), { score: 60 }), "unknown");
  assert.equal(leadSeparation({ score: 80 }, { score: 60 }), "unknown");
});

test("unknown when there is no runner-up (a field of one has nothing to separate from)", () => {
  assert.equal(leadSeparation(banded(80, 76, 84), null), "unknown");
});

test("unknown when either score is absent — an unmeasured candidate cannot be separated", () => {
  assert.equal(leadSeparation({ score: null, confidence: { low: 0, high: 0 } }, banded(60, 56, 64)), "unknown");
});

test("separationNote states the overlap honestly and names the runner-up", () => {
  const note = separationNote("overlapping", "Alice", "Bob");
  assert.match(note, /not separated/i);
  assert.match(note, /Bob/);
});

test("separationNote is empty for a separated lead — no noise when the gap is real", () => {
  assert.equal(separationNote("separated", "Alice", "Bob"), "");
});

test("separationNote is empty when separation is unknown — absence is not a claim", () => {
  assert.equal(separationNote("unknown", "Alice", "Bob"), "");
});
