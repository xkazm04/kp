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

import { eligibleRunnerUp, leadSeparation, separationNote, type BandedCandidate } from "./group-eval-separation.ts";

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

// ---- WHICH rival the crown is hedged against (scan-sweep) ------------------
//
// group-eval-run used to take the runner-up as `candidates.find((c) => c !== lead)` —
// the next row in the ko-aware order, KO status ignored. Because that sort puts every
// ko-PASSING candidate ahead of every ko-FAILED one, the only way row 2 is ko-failed is
// that the lead is the SOLE eligible candidate — and there the old rule produced
// "overlapping" against someone who fails the role's must-haves, appended
// "…Treat the top two as a tie on the evidence available." to the summary, and SEALED
// that sentence as the decision rationale (and payload.leadSeparation = "overlapping",
// which the modal renders as an "effectively tied" chip beside the crown).
//
// NON-VACUITY: against the old expression the first assertion below returns the
// ko-failed `bo` instead of null, so it FAILS; the ungated + no-rival cases pin that the
// ordinary paths are untouched.
const koCand = (id: string, koPassed?: boolean) => ({ id, koPassed });

test("eligibleRunnerUp skips a knockout-FAILED rival (it can never take the crown)", () => {
  const ada = koCand("ada", true);
  const bo = koCand("bo", false);
  assert.equal(eligibleRunnerUp([ada, bo], ada), null, "a ko-failed rival is no runner-up — the lead stands alone");
});

test("eligibleRunnerUp returns the next ELIGIBLE rival, skipping ko-failed ones in between", () => {
  const ada = koCand("ada", true);
  const bo = koCand("bo", false);
  const cy = koCand("cy", true);
  assert.equal(eligibleRunnerUp([ada, bo, cy], ada), cy);
});

test("eligibleRunnerUp treats an UNGATED candidate (no ranker, koPassed undefined) as eligible", () => {
  const ada = koCand("ada");
  const bo = koCand("bo");
  assert.equal(eligibleRunnerUp([ada, bo], ada), bo, "a job-less role gates nobody — the ordinary hedge still applies");
});

test("eligibleRunnerUp is null with no lead and with a field of one", () => {
  const ada = koCand("ada", true);
  assert.equal(eligibleRunnerUp([ada], null), null);
  assert.equal(eligibleRunnerUp([ada], ada), null);
});

test("a lead with no eligible runner-up separates to 'unknown' — no tie is ever claimed", () => {
  // The end-to-end consequence: leadSeparation(lead, null) is "unknown" and
  // separationNote("unknown", …) is empty, so nothing is appended to the sealed rationale.
  const lead = { ...banded(70, 60, 80), koPassed: true };
  const koFailed = { ...banded(68, 58, 78), koPassed: false };
  // The bands DO overlap — the old rule would have sealed the tie caveat on this field.
  assert.equal(leadSeparation(lead, koFailed), "overlapping");
  assert.equal(leadSeparation(lead, eligibleRunnerUp([lead, koFailed], lead)), "unknown");
  assert.equal(separationNote(leadSeparation(lead, eligibleRunnerUp([lead, koFailed], lead)), "Ada", "Bo"), "");
});
