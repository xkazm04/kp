import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCalibration,
  computeCalibrationCohorts,
  recommendScreeningThreshold,
  computeThresholdEffect,
  calibrationLeakage,
  asCalibrationOutcome,
  CALIBRATION_OUTCOME_AXES,
  MIN_CALIBRATION_OUTCOMES,
  MIN_CALIBRATION_BAND_OUTCOMES,
  MIN_THRESHOLD_EFFECT_OUTCOMES,
  CALIBRATION_BIN_COUNT,
  type ScoreOutcome,
  type ScoreOutcomeAt,
} from "./calibration.ts";

test("empty input: n=0, brier null, not calibrated, ten empty bins", () => {
  const r = computeCalibration([]);
  assert.equal(r.n, 0);
  assert.equal(r.positives, 0);
  assert.equal(r.brier, null);
  assert.equal(r.calibrated, false);
  assert.equal(r.bins.length, CALIBRATION_BIN_COUNT);
  assert.ok(r.bins.every((b) => b.count === 0 && b.predicted === 0 && b.observed === 0));
});

test("a perfectly-confident-and-correct set has Brier 0", () => {
  // score 100 -> prob 1 -> outcome 1; score 0 -> prob 0 -> outcome 0.
  const pairs: ScoreOutcome[] = [
    { score: 100, outcome: 1 },
    { score: 0, outcome: 0 },
    { score: 100, outcome: 1 },
    { score: 0, outcome: 0 },
  ];
  const r = computeCalibration(pairs, 1);
  assert.equal(r.n, 4);
  assert.equal(r.positives, 2);
  assert.equal(r.brier, 0);
  assert.equal(r.calibrated, true);
});

test("an overconfident-wrong set has Brier 1 (max error)", () => {
  // Predicts 100% but the outcome is always 0 (and vice-versa) -> (1-0)^2 = 1.
  const pairs: ScoreOutcome[] = [
    { score: 100, outcome: 0 },
    { score: 0, outcome: 1 },
  ];
  const r = computeCalibration(pairs, 1);
  assert.equal(r.brier, 1);
});

test("prob === 1 (score 100) lands in the LAST bin, not an 11th", () => {
  const r = computeCalibration([{ score: 100, outcome: 1 }], 1);
  assert.equal(r.bins.length, CALIBRATION_BIN_COUNT);
  assert.equal(r.bins[CALIBRATION_BIN_COUNT - 1].count, 1);
  assert.equal(r.bins[CALIBRATION_BIN_COUNT - 1].observed, 1);
});

test("observed rate per bin reflects the real positive fraction", () => {
  // Four scores in the [70,80) bin: 3 advanced, 1 passed -> observed 0.75.
  const pairs: ScoreOutcome[] = [
    { score: 72, outcome: 1 },
    { score: 74, outcome: 1 },
    { score: 76, outcome: 1 },
    { score: 78, outcome: 0 },
  ];
  const r = computeCalibration(pairs, 1);
  const bin = r.bins[7]; // [0.7, 0.8)
  assert.equal(bin.count, 4);
  assert.equal(bin.observed, 0.75);
  assert.ok(Math.abs(bin.predicted - 0.75) < 1e-9); // mean of .72/.74/.76/.78
});

test("calibrated flag respects the minimum-outcomes gate (default + override)", () => {
  const few = Array.from({ length: MIN_CALIBRATION_OUTCOMES - 1 }, () => ({ score: 50, outcome: 1 }));
  assert.equal(computeCalibration(few).calibrated, false);
  const enough = Array.from({ length: MIN_CALIBRATION_OUTCOMES }, () => ({ score: 50, outcome: 1 }));
  assert.equal(computeCalibration(enough).calibrated, true);
  assert.equal(computeCalibration(few, 5).calibrated, true); // override lowers the bar
});

test("non-finite / out-of-range scores are clamped, never NaN", () => {
  const r = computeCalibration(
    [
      { score: Number.NaN, outcome: 1 },
      { score: 150, outcome: 1 },
      { score: -20, outcome: 0 },
    ],
    1
  );
  assert.ok(r.brier !== null && Number.isFinite(r.brier));
  assert.equal(r.bins[0].count, 2); // NaN->0 and -20->0 both land in bin 0
  assert.equal(r.bins[CALIBRATION_BIN_COUNT - 1].count, 1); // 150 clamps to prob 1 -> last bin
});

test("outcome is coerced to 0/1 around 0.5", () => {
  const r = computeCalibration(
    [
      { score: 80, outcome: 0.9 },
      { score: 80, outcome: 0.2 },
    ],
    1
  );
  assert.equal(r.positives, 1);
});

// ─── Drift cohorts (Direction 1) ──────────────────────────────────────────────

test("cohorts bucket by calendar quarter (UTC), ascending", () => {
  const pairs: ScoreOutcomeAt[] = [
    { score: 80, outcome: 1, at: "2026-05-10T12:00:00.000Z" }, // Q2
    { score: 40, outcome: 0, at: "2026-02-01T00:00:00.000Z" }, // Q1
    { score: 60, outcome: 1, at: "2026-04-30T23:00:00.000Z" }, // Q2
  ];
  const cohorts = computeCalibrationCohorts(pairs, 1);
  assert.deepEqual(cohorts.map((c) => c.key), ["2026-Q1", "2026-Q2"]);
  assert.equal(cohorts[0].n, 1);
  assert.equal(cohorts[1].n, 2);
  assert.equal(cohorts[0].quarter, 1);
  assert.equal(cohorts[1].quarter, 2);
});

test("a cohort below the gate reports n but NO brier (honest per cohort)", () => {
  // Five decided candidates in one quarter, gate at 20 → not calibrated.
  const pairs: ScoreOutcomeAt[] = Array.from({ length: 5 }, (_, i) => ({
    score: 70,
    outcome: i % 2,
    at: "2026-07-05T00:00:00.000Z",
  }));
  const [c] = computeCalibrationCohorts(pairs); // default gate = 20
  assert.equal(c.n, 5);
  assert.equal(c.calibrated, false);
  assert.equal(c.brier, null, "no Brier drawn on a handful of points");
});

test("a cohort at/above the gate reports its brier", () => {
  const pairs: ScoreOutcomeAt[] = Array.from({ length: MIN_CALIBRATION_OUTCOMES }, () => ({
    score: 100,
    outcome: 1,
    at: "2026-01-15T00:00:00.000Z",
  }));
  const [c] = computeCalibrationCohorts(pairs);
  assert.equal(c.calibrated, true);
  assert.equal(c.brier, 0);
});

test("malformed / empty timestamps are excluded from the time view, not misbucketed", () => {
  const pairs: ScoreOutcomeAt[] = [
    { score: 80, outcome: 1, at: "not-a-date" },
    { score: 80, outcome: 1, at: "" },
    { score: 80, outcome: 1, at: "2026-03-01T00:00:00.000Z" },
  ];
  const cohorts = computeCalibrationCohorts(pairs, 1);
  assert.equal(cohorts.length, 1);
  assert.equal(cohorts[0].n, 1);
});

// ─── Threshold recommendation (Direction 3) ───────────────────────────────────

function bandPairs(score: number, positives: number, negatives: number): ScoreOutcome[] {
  return [
    ...Array.from({ length: positives }, () => ({ score, outcome: 1 })),
    ...Array.from({ length: negatives }, () => ({ score, outcome: 0 })),
  ];
}

// The below-floor band is read from the CLEAN ARM (the entries the screening wave
// spared), never from the contaminated pairs — see the RATCHET GUARD note on
// recommendScreeningThreshold. Most cases therefore need a holdout arm to say
// anything at all; `cleanBelow` is the stock one.
function cleanBelow(positives: number, negatives: number): ScoreOutcome[] {
  return bandPairs(40, positives, negatives);
}

test("recommendation is null below the overall outcome gate", () => {
  const pairs = bandPairs(40, 5, 5); // n=10 < 20
  assert.equal(recommendScreeningThreshold(pairs, cleanBelow(8, 0), 45), null);
});

test("recommendation is null when a threshold sits at the edges", () => {
  const pairs = bandPairs(40, 12, 12);
  assert.equal(recommendScreeningThreshold(pairs, cleanBelow(8, 0), 0), null);
  assert.equal(recommendScreeningThreshold(pairs, cleanBelow(8, 0), 100), null);
});

test("suggests LOWERING when SPARED candidates just below the floor mostly advanced", () => {
  // Floor 45; the clean arm's [35,45) band advanced 9/10 (0.9 ≥ 0.6).
  const pairs: ScoreOutcome[] = bandPairs(80, 10, 10); // padding so overall n ≥ 20
  const rec = recommendScreeningThreshold(pairs, cleanBelow(9, 1), 45);
  assert.ok(rec);
  assert.equal(rec!.direction, "lower");
  assert.equal(rec!.suggestedThreshold, 35);
  assert.deepEqual(rec!.band, { lo: 35, hi: 45 });
  assert.equal(rec!.n, 10);
  assert.equal(rec!.advanceRatePct, 90);
});

test("suggests RAISING when candidates just above the floor mostly did not advance", () => {
  // Floor 45; the [45,55) band advanced 1/10 (0.1 ≤ 0.4). The clean arm below the
  // floor is present and unremarkable (5/10), so "lower" genuinely lost — it was not
  // structurally excluded.
  const pairs: ScoreOutcome[] = [
    ...bandPairs(50, 1, 9), // just above the floor — mostly rejected
    ...bandPairs(90, 10, 0), // padding for the overall gate
  ];
  const rec = recommendScreeningThreshold(pairs, cleanBelow(5, 5), 45);
  assert.ok(rec);
  assert.equal(rec!.direction, "raise");
  assert.equal(rec!.suggestedThreshold, 55);
});

// THE RATCHET (craft-scan 2026-08-20). Below-floor entries are exactly the ones the
// screening wave closed as `rejected`, i.e. outcome 0 BY CONSTRUCTION. If the
// below-floor band were read from those pairs, "lower" could never fire and the only
// advice the panel could ever show — one click from the live auto-reject floor —
// would be "raise". A workspace whose sole below-floor evidence is wave-made must
// therefore produce NOTHING.
test("a workspace whose below-floor outcomes are all wave-made cannot produce a raise", () => {
  const pairs: ScoreOutcome[] = [
    ...bandPairs(40, 0, 12), // below the floor: 12 auto-rejects the score itself caused
    ...bandPairs(50, 1, 9), // above the floor: a textbook "raise" signal (10%)
    ...bandPairs(90, 10, 0), // padding for the overall gate
  ];
  // No clean arm at all — the holdout is off, or nobody spared has decided yet.
  assert.equal(recommendScreeningThreshold(pairs, [], 45), null);
  // And the contaminated below-floor band must not be able to stand in for it:
  // passing those same pairs as the "clean" arm is the ONLY way a raise appears,
  // which is precisely the wiring this guard forbids at the call sites.
  assert.equal(recommendScreeningThreshold(pairs, bandPairs(40, 0, 12), 45)!.direction, "raise");
});

test("a raise is refused when the clean below-floor band is too thin to argue back", () => {
  const pairs: ScoreOutcome[] = [
    ...bandPairs(50, 1, 9), // above the floor — a clear raise signal
    ...bandPairs(90, 10, 0),
  ];
  assert.ok(MIN_CALIBRATION_BAND_OUTCOMES > 3);
  assert.equal(recommendScreeningThreshold(pairs, cleanBelow(3, 0), 45), null);
});

test("recommendation is null when the near-floor bands are too sparse to defend", () => {
  // Overall n ≥ 20, but only 3 spared candidates sit in the below-floor band.
  const pairs: ScoreOutcome[] = bandPairs(80, 20, 0); // far from the floor — no adjacent signal
  assert.ok(MIN_CALIBRATION_BAND_OUTCOMES > 3);
  assert.equal(recommendScreeningThreshold(pairs, cleanBelow(3, 0), 45), null);
});

// THE TOP OF THE SCALE. The above-floor band is clamped to `min(100, T + bandWidth)`,
// so any floor at 90+ produced `[T, 100)` — a band that could not see a perfect 100.
// The advice is one click from the live auto-reject floor, so a band blind to its own
// best candidates is not a rounding detail.
test("the above-floor band at the top of the scale INCLUDES a perfect 100", () => {
  // Floor 95. Eight 97s advanced 1/8 — a textbook "raise". Five 100s all advanced, so
  // the band's real rate is 6/13 = 46%, ABOVE the 40% gate: there is nothing to advise.
  // NON-VACUITY: with `score < 100` the five 100s vanished and this returned
  // { direction: "raise", suggestedThreshold: 100 } off an 12.5% rate.
  const cleanArm = bandPairs(90, 4, 4); // [85,95), 8 spared, 50% — no "lower" either
  const pairs: ScoreOutcome[] = [
    ...bandPairs(97, 1, 7),
    ...bandPairs(100, 5, 0),
    ...bandPairs(20, 0, 20), // padding for the overall gate, far below the floor
  ];
  assert.equal(recommendScreeningThreshold(pairs, cleanArm, 95), null);

  // And when the 100-scorers fail too, the raise still fires — over ALL thirteen.
  const allFail: ScoreOutcome[] = [...bandPairs(97, 1, 7), ...bandPairs(100, 0, 5), ...bandPairs(20, 0, 20)];
  const rec = recommendScreeningThreshold(allFail, cleanArm, 95);
  assert.ok(rec);
  assert.equal(rec!.direction, "raise");
  assert.equal(rec!.n, 13, "the 100-scorers are inside the top band, not outside every band");
  assert.equal(rec!.advanceRatePct, 8); // 1/13
});

test("recommendation is null when adjacent bands are unremarkable (~50/50)", () => {
  const pairs: ScoreOutcome[] = [
    ...bandPairs(40, 5, 5), // below floor in the contaminated arm — ignored by design
    ...bandPairs(50, 5, 5), // above floor — 0.5
  ];
  assert.equal(recommendScreeningThreshold(pairs, cleanBelow(5, 5), 45), null);
});

// ─── Threshold-change effect (threshold-story) ────────────────────────────────

function at(score: number, outcome: 0 | 1, iso: string): ScoreOutcomeAt {
  return { score, outcome, at: iso };
}
const BEFORE = "2026-01-01T00:00:00.000Z";
const AFTER = "2026-06-01T00:00:00.000Z";
const APPLY = "2026-03-01T00:00:00.000Z";

test("effect splits a band's decisions before vs after the apply timestamp", () => {
  const pairs: ScoreOutcomeAt[] = [
    // before: 4 in band, 1 advanced → 25%
    at(40, 1, BEFORE), at(41, 0, BEFORE), at(42, 0, BEFORE), at(43, 0, BEFORE),
    // after: 8 in band (all < hi=45), 6 advanced → 75%
    ...Array.from({ length: 6 }, () => at(40, 1, AFTER)),
    ...Array.from({ length: 2 }, () => at(44, 0, AFTER)),
    // out of band — never counted
    at(80, 1, AFTER), at(10, 0, BEFORE),
  ];
  const eff = computeThresholdEffect(pairs, { lo: 35, hi: 45 }, APPLY);
  assert.ok(eff);
  assert.equal(eff!.measurable, true, "8 after ≥ the band floor");
  assert.equal(eff!.before!.n, 4);
  assert.equal(eff!.before!.advanceRatePct, 25);
  assert.equal(eff!.after!.n, 8);
  assert.equal(eff!.after!.advanceRatePct, 75);
});

test("a tiny 'after' sample is NOT measurable — never a confident tiny-n percentage", () => {
  const pairs: ScoreOutcomeAt[] = [
    ...Array.from({ length: 10 }, () => at(40, 1, BEFORE)), // plenty before
    at(40, 1, AFTER), at(41, 0, AFTER), // only 2 after < MIN
  ];
  assert.ok(MIN_THRESHOLD_EFFECT_OUTCOMES > 2);
  const eff = computeThresholdEffect(pairs, { lo: 35, hi: 45 }, APPLY);
  assert.ok(eff);
  assert.equal(eff!.measurable, false);
  assert.equal(eff!.after!.n, 2);
});

test("no in-band decision before the apply → before is null (after-only)", () => {
  const pairs: ScoreOutcomeAt[] = Array.from({ length: 8 }, (_, i) => at(40, i % 2 as 0 | 1, AFTER));
  const eff = computeThresholdEffect(pairs, { lo: 35, hi: 45 }, APPLY);
  assert.ok(eff);
  assert.equal(eff!.before, null);
  assert.equal(eff!.after!.n, 8);
  assert.equal(eff!.measurable, true);
});

test("band membership mirrors the recommendation's [lo, hi): hi is exclusive", () => {
  const pairs: ScoreOutcomeAt[] = [
    ...Array.from({ length: 8 }, () => at(44, 1, AFTER)), // in band
    at(45, 1, AFTER), // exactly hi → excluded
    at(34, 1, AFTER), // below lo → excluded
  ];
  const eff = computeThresholdEffect(pairs, { lo: 35, hi: 45 }, APPLY);
  assert.ok(eff);
  assert.equal(eff!.after!.n, 8, "score 45 (== hi) and 34 (< lo) are excluded");
});

test("a sealed TOP-of-scale band measures its 100-scorers on the side they happened", () => {
  // The band a recommendation sealed must later be measured with the membership it
  // was argued from. NON-VACUITY: with `score >= hi` excluded, the four 100s were
  // dropped and the after-side read n=8 / 0% instead of n=12 / 33%.
  const pairs: ScoreOutcomeAt[] = [
    ...Array.from({ length: 8 }, () => at(97, 0, AFTER)),
    ...Array.from({ length: 4 }, () => at(100, 1, AFTER)),
  ];
  const eff = computeThresholdEffect(pairs, { lo: 95, hi: 100 }, APPLY);
  assert.ok(eff);
  assert.equal(eff!.after!.n, 12);
  assert.equal(eff!.after!.advanced, 4);
  assert.equal(eff!.after!.advanceRatePct, 33);
});

test("a pair with a malformed timestamp is dropped, never misattributed to a side", () => {
  const pairs: ScoreOutcomeAt[] = [
    ...Array.from({ length: 8 }, () => at(40, 1, AFTER)),
    at(40, 0, "not-a-date"),
  ];
  const eff = computeThresholdEffect(pairs, { lo: 35, hi: 45 }, APPLY);
  assert.ok(eff);
  assert.equal(eff!.after!.n, 8, "the malformed-timestamp pair is excluded");
});

test("an unparseable apply timestamp returns null (nothing to measure against)", () => {
  const pairs: ScoreOutcomeAt[] = [at(40, 1, AFTER)];
  assert.equal(computeThresholdEffect(pairs, { lo: 35, hi: 45 }, "nope"), null);
});

// ─── label-leakage honesty (UAT KAT-L1-001) ───────────────────────────────────

test("the pipeline curve is flagged high-leakage because the score caused the label", () => {
  const l = calibrationLeakage("pipeline");
  assert.equal(l.level, "high");
  assert.equal(l.code, "score-caused-label");
  // It must point the reader at the one arm that isn't circular.
  assert.match(l.ceiling, /holdout/);
});

test("the holdout curve is the low-leakage clean arm and still names its ceiling", () => {
  const l = calibrationLeakage("holdout");
  assert.equal(l.level, "low");
  assert.equal(l.code, "no-automated-leakage");
  // "clean arm" must never overstate: the reviewer still saw the score, and the
  // arm only covers the below-floor range.
  assert.match(l.ceiling, /score-blind|below-floor/);
  assert.notEqual(l.ceiling, "");
});

test("the analysis curve sits in between — human label, but not score-blind", () => {
  const l = calibrationLeakage("analysis");
  assert.equal(l.level, "medium");
  assert.equal(l.code, "reviewer-saw-score");
});

test("every source names a non-empty coupling story", () => {
  for (const s of ["pipeline", "analysis", "holdout"] as const) {
    const l = calibrationLeakage(s);
    assert.ok(l.note.length > 0, `${s} must state how its label is produced`);
  }
});

// ─── The outcome axis (UAT KAT-L1-003) ────────────────────────────────────────

test("the outcome vocabulary is closed and defaults to the historical label", () => {
  assert.deepEqual([...CALIBRATION_OUTCOME_AXES], ["advance", "hired"]);
  // Anything that isn't the new axis stays on the one every existing reader knows —
  // a typo in a query string may not silently redefine what "success" means.
  assert.equal(asCalibrationOutcome("hired"), "hired");
  assert.equal(asCalibrationOutcome("advance"), "advance");
  assert.equal(asCalibrationOutcome("Hired"), "advance");
  assert.equal(asCalibrationOutcome(""), "advance");
  assert.equal(asCalibrationOutcome(null), "advance");
  assert.equal(asCalibrationOutcome(undefined), "advance");
});

test("the hire axis gets its OWN coupling story, and it is not a downgrade", () => {
  const hire = calibrationLeakage("pipeline", "hired");
  const screen = calibrationLeakage("pipeline", "advance");
  assert.notEqual(hire.code, screen.code, "the hire axis must not inherit the screening story");
  assert.equal(hire.code, "score-caused-rejects");
  // The point that is IN ITS FAVOUR, and must be stated rather than assumed: the
  // positive label is a chain of human decisions the score did not make.
  assert.match(hire.note, /not produced by the score|did not/i);
  // …and the point that keeps it honest: the negatives still contain every
  // auto-rejection the score produced, so the level does NOT drop. This is what
  // keeps the structural bar in calibrationVerdict.ts applying to this arm too.
  assert.equal(hire.level, "high", "a less circular arm is still a circular one");
  assert.match(hire.note, /less circular/i);
  assert.ok(hire.ceiling.length > 0, "the hire axis must name what it still cannot show");
  // It must never be mistaken for a hire-QUALITY measure: nobody has entered a
  // performance rating anywhere in kp.
  assert.match(hire.ceiling, /performed/i);
});

test("the axis defaults to the screening story, and every arm states one", () => {
  assert.deepEqual(calibrationLeakage("pipeline"), calibrationLeakage("pipeline", "advance"));
  for (const s of ["pipeline", "analysis", "holdout"] as const) {
    for (const o of CALIBRATION_OUTCOME_AXES) {
      const l = calibrationLeakage(s, o);
      assert.ok(l.note.length > 0, `${s}/${o} must state how its label is produced`);
      assert.ok(l.ceiling.length > 0, `${s}/${o} must name its remaining limit`);
    }
  }
});

test("a hire cohort's tiny positive count cannot manufacture a flattering number", () => {
  // The arithmetic guardrail for the low base rate the hire axis brings. A cohort
  // that hires 1 in 20 has baseBrier 0.0475, so the constant predictor is already
  // very good and a 0-100 match score read as a hire probability is far worse than
  // it — which is what the skill score must say, loudly, rather than rounding to
  // something comfortable. (`calibrationSkill` itself is pinned in
  // calibrationVerdict.test.ts; this pins the honesty GATE around it.)
  const pairs: ScoreOutcome[] = [
    { score: 90, outcome: 1 },
    ...Array.from({ length: 19 }, () => ({ score: 70, outcome: 0 })),
  ];
  const r = computeCalibration(pairs);
  assert.equal(r.n, 20);
  assert.equal(r.positives, 1);
  assert.equal(r.calibrated, true, "the gate is n >= minOutcomes on THIS arm's own count");
  // Nineteen 0.70 predictions against a 0 outcome: the Brier is dominated by them.
  assert.ok(r.brier! > 0.4, `expected a badly-scored arm, got ${r.brier}`);

  // …and one positive short of the gate, the SAME cohort is refused a curve —
  // the honesty gate applies per arm, not once for the workspace.
  const short = computeCalibration(pairs.slice(0, 19));
  assert.equal(short.calibrated, false);
  assert.equal(short.n, 19);
});
