// Salary-band validation shared by the JD authoring form (JdTemplates) and the
// write trust boundary (ingest-job), so the advertised JD band and the
// matchable Job's band never disagree. A valid band is two positive numbers
// with min <= max; a backwards range is corrected by swapping rather than
// dropped, and non-positive/degenerate values are rejected.
export type SalaryBand = [number, number];

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

function coerceString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
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
    currency: coerceString(p.currency, "CZK"),
    // Conservative defaults: an absent confidence reads "low", never a confident
    // claim the payload didn't actually make.
    confidence: coerceString(p.confidence, "low"),
    summary: coerceString(p.summary, ""),
  };
}
