/*
 * The orbit's ring bands, pure ("The Orbit, Lit", the /contest orbit-overview winner B/1, 2026-09-30).
 *
 * A band's AREA is proportional to the people standing on its stage (equal density), so a 43-person
 * Offer ring is not a smear and a 6-person Hired hub is not a void. A floor keeps an empty or tiny
 * stage a band you can still read a label in: every band gets `floor` people's worth of area, and
 * the floor rises until no band is thinner than `minPx`. When even that cannot hold (a tiny orbit
 * with many stages) the bands fall back to an even split.
 *
 * Bands run outside in, the same order as the axis: index 0 is the entry stage (outermost), the last
 * is the terminal stage at the hub. Radii are FRACTIONS of the orbit's radius R. The hub keeps a hole
 * at its centre (the hub's own label sits in it), exactly as the fixed template did.
 */

export type Band = [number, number];

/** The hole at the hub's centre, as a fraction of R: never under 26px, never under 7.5% of R. */
export function hubHole(R: number): number {
  return Math.max(0.075, 26 / R);
}

/** Radii for `weights` (outside in) between the hub hole and the rim: each band's area follows its weight. */
function bandsFor(weights: readonly number[], inner: number): Band[] {
  const n = weights.length;
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const span = 1 - inner * inner;
  const out: Band[] = new Array(n);
  let cum = 0;
  let r0 = inner;
  // from the hub outward: the terminal band first
  for (let i = n - 1; i >= 0; i--) {
    cum += weights[i];
    const r1 = i === 0 ? 1 : Math.sqrt(inner * inner + (span * cum) / total);
    out[i] = [r0, r1];
    r0 = r1;
  }
  return out;
}

/** Even bands between the hole and the rim (the fallback, and the answer for an empty board). */
export function evenBands(count: number, inner: number): Band[] {
  const step = (1 - inner) / Math.max(1, count);
  return Array.from({ length: count }, (_, i) => [1 - (i + 1) * step, 1 - i * step] as Band);
}

/**
 * Equal-density bands for `counts` people per stage (outside in) on an orbit of radius `R` px.
 * `minPx` is the thinnest band allowed, in px (a 14px label needs about 18px).
 */
export function ringBands(counts: readonly number[], R: number, minPx = 20): Band[] {
  const n = counts.length;
  if (n === 0) return [];
  const inner = hubHole(R);
  const people = counts.reduce((s, c) => s + Math.max(0, c), 0);
  // An unreachable minimum (too many stages for the radius) settles for the even split.
  const minFrac = Math.min(minPx / R, ((1 - inner) / n) * 0.92);
  if (people === 0) return evenBands(n, inner);
  let floor = Math.max(3, people * 0.04);
  for (let attempt = 0; attempt < 24; attempt++) {
    const bands = bandsFor(counts.map((c) => Math.max(0, c) + floor), inner);
    if (bands.every(([a, b]) => b - a >= minFrac - 1e-9)) return bands;
    floor *= 1.5;
  }
  return evenBands(n, inner);
}
