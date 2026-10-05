/*
 * Wire geometry (pure; pinned by wireGeometry.test.ts): a card beside a round figure wired to the ring its
 * items stand on, threads from the wire's end to each lit item, and the hand note's pointing arrow.
 * Lifted from the Overview ("The Orbit, Lit"); every coordinate is in the scene's own box (the
 * element the `Wires` layer covers), so the caller measures once and this module only draws.
 */

export type Pt = { x: number; y: number };
export type Box = { left: number; top: number; right: number; bottom: number };
export type Wire = { x1: number; y1: number; x2: number; y2: number };

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * A card's wire: from the card's edge that faces the figure to the middle of its ring (`band`,
 * inner and outer radius in px), at the angle that faces the card, so the wire never crosses the
 * figure. Null when the card sits over the figure (a stacked layout has no room for a wire).
 */
export function wireFor(card: Box, center: Pt, band: readonly [number, number], R: number): Wire | null {
  const mid = (card.left + card.right) / 2;
  if (Math.abs(mid - center.x) < R * 1.3) return null;
  const left = mid < center.x;
  const x1 = left ? card.right : card.left;
  const y1 = (card.top + card.bottom) / 2;
  const rm = (band[0] + band[1]) / 2;
  const ang = Math.atan2(y1 - center.y, x1 - center.x);
  return { x1: r1(x1), y1: r1(y1), x2: r1(center.x + Math.cos(ang) * rm), y2: r1(center.y + Math.sin(ang) * rm) };
}

/** The wire as a path: out level from the card, then in to the ring (a cubic with both handles at mid-x). */
export function wirePath(w: Wire): string {
  const mx = r1((w.x1 + w.x2) / 2);
  return `M ${w.x1} ${w.y1} C ${mx} ${w.y1}, ${mx} ${w.y2}, ${w.x2} ${w.y2}`;
}

/** A thread from a wire's end to one lit item, bowed gently toward the hub. */
export function threadPath(from: Pt, to: Pt, center: Pt): string {
  const qx = center.x + ((from.x - center.x + (to.x - center.x)) / 2) * 0.9;
  const qy = center.y + ((from.y - center.y + (to.y - center.y)) / 2) * 0.9;
  return `M ${r1(from.x)} ${r1(from.y)} Q ${r1(qx)} ${r1(qy)} ${r1(to.x)} ${r1(to.y)}`;
}

/** The point nearest `to`, or null for none. */
export function nearest<T extends Pt>(to: Pt, points: readonly T[]): T | null {
  let best: T | null = null;
  let bd = Infinity;
  for (const p of points) {
    const d = Math.hypot(p.x - to.x, p.y - to.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/**
 * A hand note's arrow, drawn as if by hand: a curve that leaves the note level, dips, and comes up
 * to just short of the target (the target stays visible), then the two strokes of its head.
 * `from` is where the note's words end, `to` the thing it points at.
 */
export function noteArrow(from: Pt, to: Pt): { shaft: string; head: string } {
  return {
    shaft: `M ${from.x} ${from.y} C ${from.x + 40} ${from.y + 6}, ${to.x - 24} ${to.y + 36}, ${to.x - 6} ${to.y + 6}`,
    head: `M ${to.x - 15} ${to.y + 8} L ${to.x - 6} ${to.y + 6} L ${to.x - 5} ${to.y + 15}`,
  };
}
