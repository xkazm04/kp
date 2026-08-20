// Pure logic for SalaryGauge, extracted so the growth-marker percentage is
// unit-testable under `node --test`.

/**
 * bug-ui-scan-2026-07-09 (analysis-result-panels #4): the growth marker's caption
 * was a fixed "+30%", but the marker sits at the caller's ROUNDED target
 * (`round(midpoint * 1.3 / 5000) * 5000`) — for a midpoint of 41 000 that target is
 * 55 000, which is +34%, not +30%. Derive the caption from the real target so the
 * label agrees with the position it points to.
 *
 * Returns the integer percent delta of `target` over `midpoint`, or `null` when
 * the delta is undefined (non-finite input or a non-positive midpoint) so the UI
 * can fall back to a plain "Target" label instead of rendering "+NaN%"/"+Infinity%".
 */
export function growthMarkerPercent(midpoint: number, target: number): number | null {
  if (!Number.isFinite(midpoint) || !Number.isFinite(target) || midpoint <= 0) return null;
  return Math.round((target / midpoint - 1) * 100);
}

/**
 * bug-ui-scan / Direction 1 (#c): the growth target was snapped to a fixed 5 000-unit
 * step (`round(target / 5000) * 5000`), which is CZK-scaled — for a EUR salary of
 * 2 500 that step is the whole paycheck, so the "target" rounded to a meaningless
 * multiple of 5 000 EUR. Scale the rounding step to the figure's own magnitude.
 *
 * THE RULE: the step is HALF the leading power of ten of the `anchor` (the salary
 * midpoint) — `10^floor(log10(anchor)) / 2`. So:
 *   - a 10 000–99 999 anchor (the entire typical CZK monthly-salary band) rounds to
 *     the nearest 5 000 — BYTE-IDENTICAL to the old hardcoded step, so CZK output is
 *     unchanged where it was already correct;
 *   - a ~2 500 EUR anchor rounds to the nearest 500, a ~25 000 to 5 000, etc. — the
 *     step always tracks the currency's magnitude instead of assuming CZK.
 * Returns 1 (a no-op step) for a non-positive/non-finite anchor so the caller's
 * `round(x / step) * step` degrades to a plain round instead of dividing by zero.
 */
export function growthRoundingStep(anchor: number): number {
  if (!Number.isFinite(anchor) || anchor <= 0) return 1;
  return Math.pow(10, Math.floor(Math.log10(anchor))) / 2;
}

/**
 * The +30%-ish growth target, rounded to a magnitude-appropriate step (see
 * {@link growthRoundingStep}). `factor` defaults to 1.3 (the +30% aspiration). The
 * single definition of the target so the gauge marker, its caption, and the card
 * text all round the SAME way in every currency.
 */
export function roundGrowthTarget(midpoint: number, factor = 1.3): number {
  if (!Number.isFinite(midpoint) || midpoint <= 0) return 0;
  const step = growthRoundingStep(midpoint);
  return Math.round((midpoint * factor) / step) * step;
}

/**
 * bug-ui-scan / Direction 1 (#e): the gauge fill opacity was `CONFIDENCE_OPACITY[c]
 * ?? 1`, so an UNKNOWN/unrecognized confidence fell through to 1 — full opacity, the
 * exact rendering of "high". Garbage displayed as maximum confidence. Map the three
 * known bands and route everything else to the LOWEST emphasis with `known: false`,
 * so the caller can render an explicit "unknown" title instead of a confident bar.
 */
export type ConfidenceEmphasis = { opacity: number; known: boolean };

export type ConfidenceGrade = "high" | "medium" | "low";

/**
 * The raw `salary.confidence` / `marketEvidence.confidence` values the engine can
 * emit (both are unconstrained `str` in pipeline/jobfit/models.py), folded onto the
 * three grades the report renders.
 *
 * "grounded" is the load-bearing entry: the analysis response schema handed to the
 * model sanctions FOUR salary grades — `"one of: low | medium | high | grounded"`
 * (pipeline/jobfit/gemini.py, ANALYSIS_RESPONSE_SCHEMA) — and "grounded" (the read
 * was corroborated against retrieved market data) is the STRONGEST of them. It used
 * to miss this map entirely, so the best-evidenced salary read painted the faintest
 * bar on the scale under a "treat this salary read as unverified" title, beside a
 * badge reading "Evidence unknown". "moderate" is the synonym Badge.tsx's
 * confidenceToken already accepts, kept here so the bar and the badge beside it can
 * never grade the same field differently.
 *
 * A Map, not an object literal, so a value like "constructor" can't reach
 * Object.prototype and resolve to a bogus grade.
 */
const CONFIDENCE_GRADES = new Map<string, ConfidenceGrade>([
  ["grounded", "high"],
  ["high", "high"],
  ["medium", "medium"],
  ["moderate", "medium"],
  ["low", "low"],
]);

/**
 * The report's evidence grade for a raw engine confidence value, or "unknown" for
 * anything outside the vocabulary. SalaryTab passes the result to ConfidenceBadge
 * (whose own token map knows nothing of "grounded"), so the badge and the gauge
 * below it always read the same grade.
 */
export function confidenceGrade(confidence: string | null | undefined): ConfidenceGrade | "unknown" {
  return CONFIDENCE_GRADES.get((confidence ?? "").trim().toLowerCase()) ?? "unknown";
}

const CONFIDENCE_OPACITY: Record<ConfidenceGrade, number> = {
  low: 0.6,
  medium: 0.8,
  high: 1,
};

// Below `low` (0.6), so an unknown band is visibly the faintest fill on the scale.
const UNKNOWN_CONFIDENCE_OPACITY = 0.4;

export function confidenceOpacity(confidence: string | null | undefined): ConfidenceEmphasis {
  const grade = confidenceGrade(confidence);
  if (grade === "unknown") return { opacity: UNKNOWN_CONFIDENCE_OPACITY, known: false };
  return { opacity: CONFIDENCE_OPACITY[grade], known: true };
}
