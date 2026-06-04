// Operability env-var parsing — the ONE place the "accept a positive, finite
// number; otherwise fall back" rule lives. Every runtime tunable (cache TTL,
// the spawn buffer ceiling, future knobs) validates its env override here
// instead of re-deriving the same reject-NaN / reject-≤0 / reject-missing guard
// inline, so the rule can never drift between call sites.

/**
 * Read a positive numeric env var, falling back when it is missing, non-numeric,
 * or ≤ 0.
 *
 * `scale` converts the env's human unit into the value's base unit — e.g.
 * megabytes → bytes with `scale: 1024 * 1024`. When a scale is given, both the
 * parsed override and the fallback are multiplied and floored to an exact
 * integer (no fractional bytes); without a scale the value passes through
 * unrounded, so a deliberately fractional knob (e.g. `0.5` cache hours) is
 * preserved. The `fallback` is therefore expressed in the same unit as the env
 * var (MB, hours, …), which keeps call sites self-documenting.
 *
 * Note: `Number("")` is `0` and `Number(undefined)` is `NaN`, so an empty or
 * absent var fails the `> 0` test and yields the fallback — the explicit
 * missing-check is subsumed by the positivity guard.
 */
export function positiveNumericEnv(
  name: string,
  fallback: number,
  options: { scale?: number } = {}
): number {
  const { scale } = options;
  const convert = (value: number): number =>
    scale === undefined ? value : Math.floor(value * scale);
  const parsed = Number(process.env[name]);
  return convert(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback);
}
