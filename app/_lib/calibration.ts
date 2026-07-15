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

// ─── Drift over time (Direction 1) ────────────────────────────────────────────
// One all-time aggregate hides a bad quarter inside a good year. Both pair
// producers already stamp a timestamp on every pair; bucketing by calendar
// quarter turns the single curve into a trend, EACH cohort honesty-gated the
// same way the headline is: no Brier / no rate on a quarter with fewer than
// `minOutcomes` decided candidates — it renders "not enough outcomes yet".

/** A (score, outcome) pair carrying the ISO timestamp of the decision it records
 *  (pipeline_entries.created_at / analyses.created_at). */
export type ScoreOutcomeAt = ScoreOutcome & { at: string };

export type CalibrationCohort = {
  key: string; // "2026-Q2" — stable sort key + display label
  year: number;
  quarter: number; // 1..4
  n: number;
  positives: number;
  brier: number | null; // null when the cohort is below the gate (never a curve on noise)
  calibrated: boolean; // n >= minOutcomes — gate each cohort independently
  minOutcomes: number;
};

/** Calendar-quarter bucket of an ISO timestamp, in UTC so the cohort a decision
 *  falls into is stable across client timezones. Returns null for a malformed /
 *  absent date — such a pair is excluded from the time view (it still counts in
 *  the all-time curve), never silently bucketed into the wrong quarter. */
function quarterOf(iso: string): { key: string; year: number; quarter: number } | null {
  if (typeof iso !== "string" || iso.length === 0) return null;
  const d = new Date(iso);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;
  const year = d.getUTCFullYear();
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
  return { key: `${year}-Q${quarter}`, year, quarter };
}

/** Bucket timestamped pairs into calendar quarters (ascending) and compute a
 *  gated CalibrationResult per quarter — the Brier/rate trend. Deterministic and
 *  side-effect free; reuses computeCalibration so a cohort's gate is identical to
 *  the headline's. */
export function computeCalibrationCohorts(
  pairs: ScoreOutcomeAt[],
  minOutcomes: number = MIN_CALIBRATION_OUTCOMES
): CalibrationCohort[] {
  const groups = new Map<string, { year: number; quarter: number; pairs: ScoreOutcome[] }>();
  for (const p of pairs) {
    const q = quarterOf(p.at);
    if (!q) continue;
    const g = groups.get(q.key) ?? { year: q.year, quarter: q.quarter, pairs: [] };
    g.pairs.push({ score: p.score, outcome: p.outcome });
    groups.set(q.key, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.year - b.year || a.quarter - b.quarter)
    .map((g) => {
      const r = computeCalibration(g.pairs, minOutcomes);
      return {
        key: `${g.year}-Q${g.quarter}`,
        year: g.year,
        quarter: g.quarter,
        n: r.n,
        positives: r.positives,
        // Honest per cohort: below the gate we surface NO number (the UI shows
        // "not enough outcomes yet"), never a Brier drawn on a handful of points.
        brier: r.calibrated ? r.brier : null,
        calibrated: r.calibrated,
        minOutcomes,
      };
    });
}

// ─── Threshold recommendation (Direction 3) ───────────────────────────────────
// Calibration used to only MEASURE. This closes the loop DETERMINISTICALLY (no
// LLM): given the measured advance rates and the live screening auto-reject floor
// (`maxMatchToReject` — candidates scoring BELOW it are auto-reject-eligible), it
// derives a display-only suggestion to move that floor, or returns null when
// there is nothing defensible to say. Applied only by an explicit human click.

/** A cohort this small can't defend a threshold move — a band needs at least this
 *  many decided candidates before its advance rate is signal, not noise. */
export const MIN_CALIBRATION_BAND_OUTCOMES = 8;

export type ThresholdRecommendation = {
  // "lower" — candidates just BELOW the floor mostly advanced, so the floor is
  //   auto-rejecting people who work out; move it down (candidate-protective).
  // "raise" — candidates just ABOVE the floor mostly did NOT advance, so the
  //   floor keeps people who get rejected downstream anyway; move it up.
  direction: "lower" | "raise";
  currentThreshold: number; // live maxMatchToReject (0..100)
  suggestedThreshold: number; // proposed maxMatchToReject (0..100)
  band: { lo: number; hi: number }; // the score band examined (0..100), the audit basis
  n: number; // decided candidates in that band
  advanceRatePct: number; // their observed advance-past-screening rate (0..100)
  totalOutcomes: number; // overall n — the top-level honesty basis
};

/**
 * Derive a threshold suggestion from the calibration pairs, honesty-gated on BOTH
 * the overall count (n >= minOutcomes) AND a per-band minimum (no advice on a
 * handful of points). Pure + deterministic. Returns null whenever nothing is
 * defensible — the caller renders no UI on null.
 *
 * The score is the SAME 0-100 match score the screen gate thresholds; the outcome
 * is 1 = advanced past screening, 0 = rejected there. We look one band-width below
 * the floor (currently reject-eligible) and one above (currently kept):
 *   • below advanced at a HIGH rate → the floor is too high → suggest lowering.
 *   • above advanced at a LOW rate → the floor is too low → suggest raising.
 * When both qualify, the better-supported band wins; a tie goes to the
 * candidate-protective "lower".
 */
export function recommendScreeningThreshold(
  pairs: ScoreOutcome[],
  currentThreshold: number,
  opts?: { minOutcomes?: number; minBandOutcomes?: number; bandWidth?: number; highRate?: number; lowRate?: number }
): ThresholdRecommendation | null {
  const minOutcomes = opts?.minOutcomes ?? MIN_CALIBRATION_OUTCOMES;
  const minBand = opts?.minBandOutcomes ?? MIN_CALIBRATION_BAND_OUTCOMES;
  const bandWidth = opts?.bandWidth ?? 10;
  const highRate = opts?.highRate ?? 0.6;
  const lowRate = opts?.lowRate ?? 0.4;

  const total = pairs.length;
  if (total < minOutcomes) return null;
  // A floor at either extreme has no band to move toward — nothing to say.
  if (!Number.isFinite(currentThreshold) || currentThreshold <= 0 || currentThreshold >= 100) return null;
  const T = currentThreshold;

  const positiveRate = (arr: ScoreOutcome[]): number =>
    arr.reduce((s, p) => s + (p.outcome >= 0.5 ? 1 : 0), 0) / arr.length;

  const lowerLo = Math.max(0, T - bandWidth);
  const below = pairs.filter((p) => p.score >= lowerLo && p.score < T);
  const upperHi = Math.min(100, T + bandWidth);
  const above = pairs.filter((p) => p.score >= T && p.score < upperHi);

  const found: ThresholdRecommendation[] = [];
  if (below.length >= minBand) {
    const r = positiveRate(below);
    if (r >= highRate) {
      found.push({
        direction: "lower",
        currentThreshold: T,
        suggestedThreshold: lowerLo,
        band: { lo: lowerLo, hi: T },
        n: below.length,
        advanceRatePct: Math.round(r * 100),
        totalOutcomes: total,
      });
    }
  }
  if (above.length >= minBand) {
    const r = positiveRate(above);
    if (r <= lowRate) {
      found.push({
        direction: "raise",
        currentThreshold: T,
        suggestedThreshold: upperHi,
        band: { lo: T, hi: upperHi },
        n: above.length,
        advanceRatePct: Math.round(r * 100),
        totalOutcomes: total,
      });
    }
  }
  if (found.length === 0) return null;
  found.sort((a, b) => b.n - a.n || (a.direction === "lower" ? -1 : 1));
  return found[0];
}

// ─── Threshold-change effect (threshold-story) ────────────────────────────────
// A recommendation is recommend→apply→HOPE unless the change is MEASURED. For the
// band the last apply targeted, split that band's decisions by the apply timestamp
// and compare the advance/reject mix BEFORE against AFTER — so an operator can see
// whether moving the floor actually changed who advances. Honesty-gated on the
// number of decisions that have ACCRUED SINCE the change: a tiny "after" sample
// reads as "too few to measure yet", never a confident tiny-n percentage. Pure +
// deterministic; the ISO timestamps already ride on every ScoreOutcomeAt pair.

/** Decisions since a threshold change can't be judged until at least this many have
 *  accrued in the affected band — below it the "after" rate is noise. Reuses the
 *  same per-band floor the recommendation itself is gated on, so the "measure it"
 *  bar is exactly the "recommend it" bar. */
export const MIN_THRESHOLD_EFFECT_OUTCOMES = MIN_CALIBRATION_BAND_OUTCOMES;

export type ThresholdEffectSide = {
  n: number;
  advanced: number;
  advanceRatePct: number; // 0..100; 0 when n === 0 — always read ALONGSIDE n, never alone
};

export type ThresholdEffect = {
  band: { lo: number; hi: number }; // the score band the last apply examined (0..100)
  appliedAt: string; // ISO timestamp of the apply the effect is measured against
  before: ThresholdEffectSide | null; // null when no in-band decision predates the apply
  after: ThresholdEffectSide | null; // null when no in-band decision postdates it
  // after != null && after.n >= minOutcomes — the ONLY state in which a percentage
  // is defensible. Below it the caller shows "too few decisions since the change".
  measurable: boolean;
  minOutcomes: number;
};

function effectSide(pairs: ScoreOutcome[]): ThresholdEffectSide | null {
  if (pairs.length === 0) return null;
  const advanced = pairs.reduce((s, p) => s + (p.outcome >= 0.5 ? 1 : 0), 0);
  return { n: pairs.length, advanced, advanceRatePct: Math.round((advanced / pairs.length) * 100) };
}

/**
 * Measure a threshold change's effect on the band it targeted: the in-band advance
 * rate BEFORE the apply vs AFTER it. Band membership mirrors the recommendation's
 * own `score >= lo && score < hi`. A pair whose timestamp can't be parsed is dropped
 * (it can't be placed either side of the apply), never misattributed. Returns null
 * only when the apply timestamp itself is unparseable; otherwise returns both sides
 * (null per side when that side is empty) and a `measurable` flag gated on the
 * decisions accrued SINCE the change.
 */
export function computeThresholdEffect(
  pairs: ScoreOutcomeAt[],
  band: { lo: number; hi: number },
  appliedAt: string,
  minOutcomes: number = MIN_THRESHOLD_EFFECT_OUTCOMES
): ThresholdEffect | null {
  const applied = new Date(appliedAt).getTime();
  if (!Number.isFinite(applied)) return null;
  const before: ScoreOutcome[] = [];
  const after: ScoreOutcome[] = [];
  for (const p of pairs) {
    if (!Number.isFinite(p.score) || p.score < band.lo || p.score >= band.hi) continue;
    const t = new Date(p.at).getTime();
    if (!Number.isFinite(t)) continue; // a malformed timestamp can't be placed either side
    (t < applied ? before : after).push({ score: p.score, outcome: p.outcome });
  }
  const afterSide = effectSide(after);
  return {
    band,
    appliedAt,
    before: effectSide(before),
    after: afterSide,
    measurable: afterSide != null && afterSide.n >= minOutcomes,
    minOutcomes,
  };
}
