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
