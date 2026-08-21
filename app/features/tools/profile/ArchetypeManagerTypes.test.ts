// Pins the Archetype Manager's weight-percentage rules — the numbers that decide HOW A
// PERSON IS SCORED, so both directions matter:
//
//   · a weight the operator must never be able to compose (a NEGATIVE share inverts its
//     dimension: stronger skills evidence → lower score), and
//   · a weight vector the operator must never be REFUSED (an exact `sum === 100` test
//     rejected 8.2% of legitimate one-decimal splits with "currently 100%", over a
//     disabled Save button).
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SLOTS,
  clampWeightPct,
  weightPctSum,
  weightPctSumOk,
  displayWeightPct,
  WEIGHT_PCT_TOLERANCE,
} from "./ArchetypeManagerTypes.ts";

// The registry's own tolerance, on the /100 scale it validates (archetype-registry.ts
// WEIGHT_SUM_TOLERANCE = 1e-6) — mirrored here so the "cannot loosen the contract"
// claim is asserted, not just commented.
const REGISTRY_TOLERANCE = 1e-6;

/* ── clampWeightPct: the negative weight must be unreachable ─────────────────── */

test("a negative percentage clamps to 0 — a weight can never subtract its dimension", () => {
  assert.equal(clampWeightPct(-10), 0);
  assert.equal(clampWeightPct(-0.0001), 0);
});

test("the -10 / 60 / 50 vector that totalled 100 can no longer be composed", () => {
  // The exact shape archetype-registry.validateArchetype calls out: it sums to 1.0 and
  // passed BOTH validators, then inverted the skills dimension in the live scorer.
  const typed = { skills: -10, career: 60, personal: 50 };
  const clamped = { skills: clampWeightPct(typed.skills), career: clampWeightPct(typed.career), personal: clampWeightPct(typed.personal) };
  assert.equal(clamped.skills, 0);
  assert.equal(weightPctSum(typed), 100, "the raw typed vector really did total 100 (that is the trap)");
  assert.equal(weightPctSumOk(weightPctSum(clamped)), false, "clamped, it no longer totals 100, so Save stays disabled with the localized sum error");
});

test("percentages above 100 clamp, and non-finite input falls back to 0", () => {
  assert.equal(clampWeightPct(1e5), 100);
  // Non-finite is not a percentage at all, so it falls back to the SAFE end (0 weight),
  // not to a full-weight 100 nobody typed.
  assert.equal(clampWeightPct(Number.NaN), 0);
  assert.equal(clampWeightPct(Number.POSITIVE_INFINITY), 0);
  assert.equal(clampWeightPct(Number.NEGATIVE_INFINITY), 0);
});

test("a legitimate percentage passes through untouched, 0 and 100 included", () => {
  assert.equal(clampWeightPct(0), 0);
  assert.equal(clampWeightPct(35), 35);
  assert.equal(clampWeightPct(33.5), 33.5);
  assert.equal(clampWeightPct(100), 100);
});

/* ── weightPctSum ────────────────────────────────────────────────────────────── */

test("weightPctSum totals the three scoring slots and treats junk as 0", () => {
  assert.equal(weightPctSum({ skills: 50, career: 35, personal: 15 }), 100);
  assert.equal(weightPctSum({ skills: Number.NaN, career: 35, personal: 15 }), 50);
  assert.deepEqual(SLOTS, ["skills", "career", "personal"]);
});

/* ── weightPctSumOk: the refusal that could not be acted on ──────────────────── */

test("a one-decimal split that adds up on paper is accepted despite float noise", () => {
  // 5.1 + 64.1 + 30.8 === 99.99999999999999 in IEEE-754 doubles.
  const sum = weightPctSum({ skills: 5.1, career: 64.1, personal: 30.8 });
  assert.notEqual(sum, 100, "the exact test really does fail here (that is the bug)");
  assert.equal(weightPctSumOk(sum), true);
});

test("no one-decimal split that adds up on paper is refused", () => {
  // The exhaustive sweep: every (a, b, c) in tenths with a + b + c = 100. An exact
  // `=== 100` test failed 41,088 of the 501,501 combinations (8.2%).
  let exactFailures = 0;
  for (let i = 0; i <= 1000; i++) {
    for (let j = 0; i + j <= 1000; j++) {
      const pct = { skills: i / 10, career: j / 10, personal: (1000 - i - j) / 10 };
      const sum = weightPctSum(pct);
      if (sum !== 100) exactFailures += 1;
      assert.equal(weightPctSumOk(sum), true, `refused ${pct.skills}/${pct.career}/${pct.personal} (sum ${sum})`);
    }
  }
  assert.ok(exactFailures > 40000, `the exact test would have refused ${exactFailures} of these`);
});

test("a total that is genuinely wrong is still refused", () => {
  assert.equal(weightPctSumOk(weightPctSum({ skills: 50, career: 35, personal: 14.9 })), false);
  assert.equal(weightPctSumOk(weightPctSum({ skills: 50, career: 35, personal: 15.1 })), false);
  assert.equal(weightPctSumOk(weightPctSum({ skills: 0, career: 0, personal: 0 })), false);
  // Not a rounding allowance: 0.001% off is a real difference the operator typed.
  assert.equal(weightPctSumOk(99.999), false);
});

test("everything this predicate admits still clears the registry's own 1e-6 guard", () => {
  // The manager posts pct/100, so the tolerance that matters is the one Python's
  // registry._validate_archetype_weights applies to the summed weights.
  for (const worst of [100 + WEIGHT_PCT_TOLERANCE / 2, 100 - WEIGHT_PCT_TOLERANCE / 2]) {
    assert.equal(weightPctSumOk(worst), true);
    assert.ok(
      Math.abs(worst / 100 - 1) < REGISTRY_TOLERANCE / 1000,
      "an accepted total must be inside the registry tolerance with orders of magnitude to spare"
    );
  }
  // And the real rounding path the brief asked about: 33 / 33 / 34.
  const thirds = weightPctSum({ skills: 33, career: 33, personal: 34 });
  assert.equal(weightPctSumOk(thirds), true);
  const sumOfWeights = 33 / 100 + 33 / 100 + 34 / 100;
  assert.ok(Math.abs(sumOfWeights - 1) < REGISTRY_TOLERANCE, "33/33/34 cannot drift past the tightened tolerance");
});

/* ── displayWeightPct ────────────────────────────────────────────────────────── */

test("an accepted total prints as exactly 100, never as float noise", () => {
  assert.equal(displayWeightPct(weightPctSum({ skills: 5.1, career: 64.1, personal: 30.8 })), 100);
  assert.equal(displayWeightPct(weightPctSum({ skills: 0.01, career: 99.98, personal: 0.01 })), 100);
  assert.equal(displayWeightPct(100), 100);
});

test("a refused total prints the de-noised number the operator can reconcile", () => {
  assert.equal(displayWeightPct(weightPctSum({ skills: 50, career: 35, personal: 14.9 })), 99.9);
  assert.equal(displayWeightPct(weightPctSum({ skills: 50, career: 35, personal: 10 })), 95);
});
