// Calibration Engine (moonshot A/C, foundational primitive P1).
//
// Turns a set of (prediction, outcome) pairs into a MEASURED reliability curve +
// Brier score — the thing that converts "trust our 0-100 score" into "a 70 from
// us advances 70% of the time, here is our error bar." The prediction is the
// existing fit score read as a probability (score/100); the outcome is a binary
// label (1 = advanced, 0 = passed). Nothing here changes the scoring engine — it
// only MEASURES the score we already emit.
//
// PURE + import-free on purpose: this module is exercised by a colocated
// `node --test` suite, which can only load a sibling that drags in no `@/` imports.

/** Below this many labeled outcomes the curve is statistical noise; callers MUST
 *  show an honest "not yet calibrated" state instead of a misleading diagram. */
export const MIN_CALIBRATION_OUTCOMES = 20;

/** Ten fixed bins over the 0-1 probability range ([0,0.1), … , [0.9,1.0]). */
export const CALIBRATION_BIN_COUNT = 10;

export type ScoreOutcome = { score: number; outcome: number };

export type CalibrationBin = {
  lo: number; // bin lower edge in probability space (0, 0.1, … 0.9)
  hi: number; // bin upper edge (0.1, … 1.0)
  count: number;
  predicted: number; // mean predicted probability of the pairs in this bin (0..1); 0 when empty
  observed: number; // observed positive rate of the pairs in this bin (0..1); 0 when empty
};

export type CalibrationResult = {
  n: number; // total usable pairs
  positives: number; // how many had outcome = 1
  brier: number | null; // mean squared error of prediction vs outcome; null when n === 0
  bins: CalibrationBin[]; // always CALIBRATION_BIN_COUNT bins (empty ones have count 0)
  calibrated: boolean; // n >= minOutcomes — gate the UI on this
  minOutcomes: number; // echoed so the UI can render "N / minOutcomes"
};

function clampProb(score: number): number {
  // The score is a 0-100 fit total; read it as a probability. Clamp defensively
  // so an out-of-range stored value can't push a pair outside [0,1] / the bins.
  if (!Number.isFinite(score)) return 0;
  const p = score / 100;
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

function binIndex(prob: number): number {
  // [0,0.1)->0 … [0.9,1.0]->9. prob === 1 must land in the last bin, not bin 10.
  const idx = Math.floor(prob * CALIBRATION_BIN_COUNT);
  return idx >= CALIBRATION_BIN_COUNT ? CALIBRATION_BIN_COUNT - 1 : idx;
}

function emptyBins(): { count: number; sumPred: number; sumObs: number }[] {
  return Array.from({ length: CALIBRATION_BIN_COUNT }, () => ({ count: 0, sumPred: 0, sumObs: 0 }));
}

/** Compute the reliability curve + Brier score for a set of (score, outcome) pairs.
 *  `outcome` is coerced to 0/1 (>= 0.5 counts as a positive). Non-finite scores are
 *  treated as 0. Deterministic and side-effect free. */
export function computeCalibration(
  pairs: ScoreOutcome[],
  minOutcomes: number = MIN_CALIBRATION_OUTCOMES
): CalibrationResult {
  const acc = emptyBins();
  let n = 0;
  let positives = 0;
  let sqErr = 0;

  for (const pair of pairs) {
    const prob = clampProb(pair.score);
    const outcome = pair.outcome >= 0.5 ? 1 : 0;
    n += 1;
    positives += outcome;
    sqErr += (prob - outcome) * (prob - outcome);
    const b = acc[binIndex(prob)];
    b.count += 1;
    b.sumPred += prob;
    b.sumObs += outcome;
  }

  const bins: CalibrationBin[] = acc.map((b, i) => ({
    lo: i / CALIBRATION_BIN_COUNT,
    hi: (i + 1) / CALIBRATION_BIN_COUNT,
    count: b.count,
    predicted: b.count > 0 ? b.sumPred / b.count : 0,
    observed: b.count > 0 ? b.sumObs / b.count : 0,
  }));

  return {
    n,
    positives,
    brier: n > 0 ? sqErr / n : null,
    bins,
    calibrated: n >= minOutcomes,
    minOutcomes,
  };
}
