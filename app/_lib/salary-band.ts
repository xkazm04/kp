import { APP_CURRENCY, formatSalaryRange } from "./format.ts";

// Salary-band validation shared by the JD authoring form (JdTemplates) and the
// write trust boundary (ingest-job), so the advertised JD band and the
// matchable Job's band never disagree. A valid band is two positive numbers
// with min <= max; a backwards range is corrected by swapping rather than
// dropped, and non-positive/degenerate values are rejected.
export type SalaryBand = [number, number];

// ---- Currency comparability (the salary-comparison contract) ----------------
// A role's salary band (job.salaryBand) is a bare [min, max] with NO currency of
// its own; by app-wide contract it is denominated in APP_CURRENCY (see format.ts).
// A candidate's expectation, by contrast, carries its OWN currency (LLM-extracted,
// defaulting to APP_CURRENCY when absent). The app does no FX conversion, so an
// over/under-band verdict is only meaningful when the two share a currency —
// comparing a EUR expectation against a CZK band yields a confident-but-meaningless
// "30% over". These helpers make that guard explicit and testable: the caller gates
// the verdict on `isSameCurrency`, and only feeds same-currency figures to the pure
// `salaryBandPosition` math.

/** Case/whitespace-insensitive currency code: "czk", " CZK ", and "CZK" all
 *  compare equal; an absent/blank value normalizes to "". */
export function normalizeCurrency(currency: string | null | undefined): string {
  return (currency ?? "").trim().toUpperCase();
}

/** Whether two monetary figures are in the same currency and can therefore be
 *  compared directly (the app does no FX). Used to gate the salary over/under-band
 *  verdict on a match between a candidate's expectation currency and the band's
 *  {@link APP_CURRENCY} denomination. */
export function isSameCurrency(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeCurrency(a) === normalizeCurrency(b);
}

export type SalaryBandPosition = "over" | "under" | "within";

/**
 * Where a candidate's expectation midpoint sits relative to the role band
 * [lo, hi]: "over" the max, "under" the min, or "within", plus the percentage
 * over/under (0 for "within"). PURE math that ASSUMES the midpoint and band are
 * already in the SAME currency — cross-currency comparison is meaningless and is
 * the caller's responsibility to prevent (gate on {@link isSameCurrency} first).
 * A non-positive bound on the relevant side is treated as "no reference", so a
 * degenerate band can't manufacture a verdict.
 */
export function salaryBandPosition(
  midpoint: number,
  lo: number,
  hi: number
): { position: SalaryBandPosition; pct: number } {
  // A non-finite midpoint yields no meaningful verdict: NaN would silently fall through to
  // "within" (a positive "matches the band" claim), and Infinity would produce an
  // "Infinity% over". Treat it as no reference instead of manufacturing a verdict.
  if (!Number.isFinite(midpoint)) return { position: "within", pct: 0 };
  if (hi > 0 && midpoint > hi) return { position: "over", pct: Math.round(((midpoint - hi) / hi) * 100) };
  if (lo > 0 && midpoint < lo) return { position: "under", pct: Math.round(((lo - midpoint) / lo) * 100) };
  return { position: "within", pct: 0 };
}

/** Human-readable reason a [min, max] band is invalid for authoring, or null if
 *  it's fine. Used by the form to block rendering a corrupted JD. */
export function salaryBandError(min: number, max: number): string | null {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) {
    return "Enter a positive minimum and maximum.";
  }
  if (min > max) return "Minimum can't exceed the maximum.";
  return null;
}

/** Sanitize an untrusted [min, max] into a usable band: swap a backwards range
 *  and reject non-finite or non-positive values. Returns null when no usable
 *  band can be formed, so callers fall back instead of advertising garbage. */
export function normalizeSalaryBand(min: unknown, max: unknown): SalaryBand | null {
  if (typeof min !== "number" || typeof max !== "number") return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) return null;
  return min <= max ? [min, max] : [max, min];
}

// The grounded market-salary band the JD builder renders and persists, as
// produced by `market_salary_cli`. This is the canonical shape — `jd-build-run`
// (server) and `JdBuilderResult` (client) both import it instead of redeclaring
// it, so the producer and the renderer can't drift.
//
// `available` is the trust-boundary discriminant: the CLI result reaches us via
// `parsePythonJson` and a lying `as` cast, so any field may be missing, NaN, the
// wrong type, or the CLI's degenerate 0–0 taxonomy miss. When no usable band can
// be formed, `available` is false and the band numbers are zeroed — consumers
// branch on that one flag to show a "salary unavailable" fallback instead of
// crashing on `undefined` or advertising a bogus "0–N" range.
export type MarketSalary = {
  available: boolean;
  suggestedMinimum: number;
  suggestedMaximum: number;
  currency: string;
  confidence: string;
  summary: string;
};

/**
 * The grounded market band rendered into a JD's salary line — the SINGLE
 * derivation shared by the AI-default body (`composeMarkdown`, server) and the
 * template-filled body (`JdBuilder`, client) so the two paths can't advertise the
 * same role's salary differently (same band, currency, and monthly period).
 * Returns "" for an unavailable band, so the AI path omits the line and the
 * template slot renders blank.
 */
export function marketSalaryLabel(s: MarketSalary): string {
  return s.available
    ? formatSalaryRange(s.suggestedMinimum, s.suggestedMaximum, { currency: s.currency, period: "month" })
    : "";
}

function coerceString(value: unknown, fallback: string): string {
  // Return the TRIMMED value — the gate already requires non-blank, but the old code
  // returned the raw string, so a padded " CZK " currency persisted/rendered with whitespace.
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * Normalize an untrusted market-salary payload (the `market_salary_cli` result,
 * reached through `parsePythonJson` and an `as` cast that the runtime never
 * checks) into a render-safe {@link MarketSalary}. The band is validated through
 * {@link normalizeSalaryBand}: a usable [min, max] sets `available: true`;
 * anything else — a missing/NaN/non-positive/irreparably-backwards band, the
 * CLI's 0–0 taxonomy miss, or a non-object payload — zeroes the band and sets
 * `available: false`. The string fields are coerced so a non-string
 * currency/confidence/summary can never reach `toLocaleString`/JSX as
 * `undefined`. Idempotent: re-normalizing an already-normalized value is a no-op,
 * so it's safe to re-run defensively at a render boundary.
 */
export function normalizeMarketSalary(payload: unknown): MarketSalary {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const band = normalizeSalaryBand(p.suggestedMinimum, p.suggestedMaximum);
  return {
    available: band !== null,
    suggestedMinimum: band ? band[0] : 0,
    suggestedMaximum: band ? band[1] : 0,
    // Fall back to the app-wide currency (the salary-comparison contract's denomination),
    // not a hardcoded "CZK" literal that silently mislabels bands if APP_CURRENCY ever changes.
    currency: coerceString(p.currency, APP_CURRENCY),
    // Conservative defaults: an absent confidence reads "low", never a confident
    // claim the payload didn't actually make.
    confidence: coerceString(p.confidence, "low"),
    summary: coerceString(p.summary, ""),
  };
}
