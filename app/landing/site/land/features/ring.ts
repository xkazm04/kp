/*
 * The features ring's geometry (prototype land/app.js): an ellipse in a
 * 1240 x 720 box, sampled once by arc length so the nine medallions sit at equal
 * distances along it (not at equal angles) and the travelling "JN" card moves at
 * a constant speed. Pure and deterministic: the server and the client compute the
 * same medallion positions, so the markup hydrates unchanged.
 */
const RX = 498;
const RY = 262;
const CX = 620;
const CY = 356;
export const RING_BOX = { w: 1240, h: 720 } as const;

type Sample = { x: number; y: number; l: number };

const SAMPLES: Sample[] = (() => {
  const out: Sample[] = [];
  let len = 0;
  let prev: { x: number; y: number } | null = null;
  for (let k = 0; k <= 1440; k++) {
    const th = -Math.PI / 2 + (k / 1440) * Math.PI * 2;
    const x = CX + RX * Math.cos(th);
    const y = CY + RY * Math.sin(th);
    if (prev) len += Math.hypot(x - prev.x, y - prev.y);
    out.push({ x, y, l: len });
    prev = { x, y };
  }
  return out;
})();

/** Total arc length of the ring. */
export const RING_LENGTH = SAMPLES[SAMPLES.length - 1].l;

/** The point at arc length `len` (wraps). */
export function ringPoint(len: number): { x: number; y: number } {
  const L = RING_LENGTH;
  const at = ((len % L) + L) % L;
  let lo = 0;
  let hi = SAMPLES.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (SAMPLES[m].l <= at) lo = m;
    else hi = m;
  }
  const a = SAMPLES[lo];
  const b = SAMPLES[hi];
  const t = (at - a.l) / (b.l - a.l || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Where medallion `i` of `n` sits, as CSS percentages of the ring box. */
export function medalPosition(i: number, n: number): { x: string; y: string } {
  const p = ringPoint((i * RING_LENGTH) / n);
  return { x: `${((p.x / RING_BOX.w) * 100).toFixed(3)}%`, y: `${((p.y / RING_BOX.h) * 100).toFixed(3)}%` };
}
