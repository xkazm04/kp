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
