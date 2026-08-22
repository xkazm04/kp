// Pins the E5 funnel-economics rules: the median math and the 72h variant
// pause heuristic (a recommendation, never an actuator). The thresholds in
// VARIANT_RULE will get tuned; these tests keep the boundary semantics from
// drifting while they do.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { medianHours, VARIANT_RULE, variantPauseRecommendations, type VariantStat } from "./source-analytics.ts";

const H = 3_600_000;

// ---------------------------------------------------------------------------
// medianHours
// ---------------------------------------------------------------------------

test("medianHours: empty and all-invalid inputs yield null", () => {
  assert.equal(medianHours([]), null);
  assert.equal(medianHours([-5, NaN, Number.NEGATIVE_INFINITY]), null);
});

test("medianHours: odd count takes the middle, 0.1h precision", () => {
  assert.equal(medianHours([1 * H, 2 * H, 10 * H]), 2);
  assert.equal(medianHours([90 * 60_000]), 1.5);
});

test("medianHours: even count averages the middle pair", () => {
  assert.equal(medianHours([1 * H, 2 * H, 3 * H, 4 * H]), 2.5);
});

test("medianHours: negative durations are dropped, not clamped", () => {
  assert.equal(medianHours([-1 * H, 3 * H]), 3);
});

// ---------------------------------------------------------------------------
// variantPauseRecommendations
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-06-11T12:00:00Z");
const OLD_ENOUGH = new Date(NOW - (VARIANT_RULE.observeHours + 1) * H).toISOString();
const TOO_YOUNG = new Date(NOW - (VARIANT_RULE.observeHours - 1) * H).toISOString();

function variant(v: string, total: number, overrides: Partial<VariantStat> = {}): VariantStat {
  return {
    jobId: "job-1",
    jobTitle: "Frontend Developer",
    campaign: "spring",
    variant: v,
    total,
    reachedInterview: 0,
    hired: 0,
    firstLeadAt: OLD_ENOUGH,
    ...overrides,
  };
}

test("flags the starving variant once the group is observable", () => {
  // 3 variants, 12 leads: fair share 33%, flag under 16.7% → v3 at 8% flags.
  const recs = variantPauseRecommendations([variant("v1", 8), variant("v2", 3), variant("v3", 1)], NOW);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].variant, "v3");
  assert.equal(recs[0].leadSharePct, 8);
  assert.equal(recs[0].groupTotal, 12);
});

test("a single-variant group never flags (nothing to reallocate to)", () => {
  assert.deepEqual(variantPauseRecommendations([variant("v1", 50)], NOW), []);
});

test("a thin group (under minGroupLeads) never flags — early noise isn't a verdict", () => {
  const recs = variantPauseRecommendations([variant("v1", 8), variant("v2", 1)], NOW);
  assert.deepEqual(recs, []);
});

test("a group younger than the observation window never flags", () => {
  const recs = variantPauseRecommendations(
    [variant("v1", 11, { firstLeadAt: TOO_YOUNG }), variant("v2", 1, { firstLeadAt: TOO_YOUNG })],
    NOW
  );
  assert.deepEqual(recs, []);
});

test("groups are independent per (job × campaign)", () => {
  const recs = variantPauseRecommendations(
    [
      // Group A: observable, v2 starving (8% < 25%).
      variant("v1", 11),
      variant("v2", 1),
      // Group B (different campaign): same shape but too young — silent.
      variant("v1", 11, { campaign: "summer", firstLeadAt: TOO_YOUNG }),
      variant("v2", 1, { campaign: "summer", firstLeadAt: TOO_YOUNG }),
    ],
    NOW
  );
  assert.equal(recs.length, 1);
  assert.equal(recs[0].campaign, "spring");
});

test("worst performers sort first", () => {
  const recs = variantPauseRecommendations(
    [variant("v1", 30), variant("v2", 2), variant("v3", 1), variant("v4", 2)],
    NOW
  );
  // fair = 25%, flag under 12.5%: v3 (~3%), v2 and v4 (~6%) all flag; v3 first.
  assert.deepEqual(
    recs.map((r) => r.variant),
    ["v3", "v2", "v4"]
  );
});

test("a variant younger than the observation window is not flagged on the GROUP's clock", () => {
  // A creative added to a long-running group. The group has run for 10 days, so the
  // group clock is satisfied — but v3 has existed for two hours, and its 1% share is
  // an artifact of that, not a verdict. NON-VACUITY: with the group clock as the only
  // gate this returned one recommendation for v3 ("holds 1% of 101 leads"), under
  // copy that promises "after 72 hours of data".
  const JUST_LAUNCHED = new Date(NOW - 2 * H).toISOString();
  const recs = variantPauseRecommendations(
    [variant("v1", 60), variant("v2", 40), variant("v3", 1, { firstLeadAt: JUST_LAUNCHED })],
    NOW
  );
  assert.deepEqual(recs, []);

  // …and the same variant IS judged once its own clock clears the window.
  const matured = variantPauseRecommendations(
    [variant("v1", 60), variant("v2", 40), variant("v3", 1)],
    NOW
  );
  assert.equal(matured.length, 1);
  assert.equal(matured[0].variant, "v3");
});

test("a starving variant that DID land leads is never reported as a flat 0%", () => {
  // 1 lead in 201 is 0.5%. NON-VACUITY: Math.round(0.4975) is 0, so the line read
  // "holds 0% of 201 leads" about a variant that produced a real lead.
  const recs = variantPauseRecommendations([variant("v1", 200), variant("v2", 1)], NOW);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].groupTotal, 201);
  assert.equal(recs[0].leadSharePct, 0.5);
  // Sub-1% shares stay distinguishable, so "worst performers first" still orders them.
  const many = variantPauseRecommendations(
    [variant("v1", 996), variant("v2", 2), variant("v3", 1), variant("v4", 4)],
    NOW
  );
  assert.deepEqual(many.map((r) => r.variant), ["v3", "v2", "v4"]);
  assert.deepEqual(many.map((r) => r.leadSharePct), [0.1, 0.2, 0.4]);
});

test("an unobservable group (no parseable first lead) flags nothing", () => {
  const recs = variantPauseRecommendations(
    [variant("v1", 11, { firstLeadAt: null }), variant("v2", 1, { firstLeadAt: "garbage" })],
    NOW
  );
  assert.deepEqual(recs, []);
});
