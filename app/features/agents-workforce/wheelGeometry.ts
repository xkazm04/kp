// The Clock Wheel's geometry and its stage layout (pure; pinned by wheelGeometry.test.ts). The dial is
// drawn in viewBox units (-500..500, scaled to fit); the plates stand beside it on wires. Ported from the
// contest winner (agents-workforce-r2 C/3, wheel.js `R`, `VB`, `layout`), which measured the DOM inline:
// here the plates' measured heights come in as numbers, so the placement is a function.

/** Radii, in viewBox units: the clock, the tether ring around it, the card's state block, the spend bar, the rings. */
export const R = { clock: 112, tether: 128, cardIn: 142, cardCut: 156, cardOut: 194, spendIn: 204, budget: 336, spendMax: 368, needs: 390, outer: 408, label: 414 } as const;
export const VB = { x: -172, y: -432, w: 596, h: 864 } as const;
/** How far right of the axis the drawing goes. */
export const REACH = R.outer + 8;

export function f1(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1);
}

/** The point at radius r, degrees clockwise from 12 o'clock. */
export function pt(r: number, deg: number): [number, number] {
  const t = (deg * Math.PI) / 180;
  return [r * Math.sin(t), -r * Math.cos(t)];
}

/** An annular sector between two radii and two angles (the drawer's wedge). */
export function arcPath(r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const p0 = pt(r1, a0);
  const p1 = pt(r1, a1);
  const p2 = pt(r0, a1);
  const p3 = pt(r0, a0);
  return `M${f1(p0[0])} ${f1(p0[1])}A${r1} ${r1} 0 ${large} 1 ${f1(p1[0])} ${f1(p1[1])}L${f1(p2[0])} ${f1(p2[1])}A${r0} ${r0} 0 ${large} 0 ${f1(p3[0])} ${f1(p3[1])}Z`;
}

/** The right half of a ring (the budget line, the empty rim). */
export function halfArc(r: number): string {
  return `M0 ${-r}A${r} ${r} 0 0 1 0 ${r}`;
}

export type PlateIn = { key: string; mid: number; height: number };
export type PlatePlace = { key: string; x: number; y: number; wire: { ex: number; ey: number; ax: number; ay: number } };

export type StageLayout = {
  /** Plates beside the dial (wide) or listed under it (narrow). */
  wide: boolean;
  plateW: number;
  /** The drawing's size in px and its scale (units -> px). */
  svgW: number;
  svgH: number;
  scale: number;
  /** Where the dial's box starts inside the stage, and the stage's height. */
  svgLeft: number;
  svgTop: number;
  stageH: number;
  head: { x: number; y: number } | null;
  plates: PlatePlace[];
};

/**
 * The stage: the dial scaled to the room, and the drawers' plates stacked by their sector's height so none
 * overlaps (the stage grows if it must), each hugging the rim at its own height and wired to its sector.
 * Narrow stages (under 600px) leave the plates to flow as a list under the dial.
 */
export function stageLayout(input: { width: number; heightBudget: number; plates: readonly PlateIn[]; headHeight: number }): StageLayout {
  const { width: W, plates } = input;
  const LW = Math.round(Math.max(256, Math.min(280, W * 0.34)));
  const wide = W >= 600 && plates.length > 0;
  const hBudget = Math.max(460, Math.min(940, input.heightBudget));
  const span = -VB.x + REACH;
  const sc = Math.max(0.3, wide ? Math.min((W - LW - 18) / span, hBudget / VB.h) : Math.min(Math.min(W, 560) / VB.w, hBudget / VB.h));
  const svgW = Math.round(VB.w * sc);
  const svgH = Math.round(VB.h * sc);
  if (!wide) {
    return { wide, plateW: LW, svgW, svgH, scale: sc, svgLeft: Math.round((W - svgW) / 2), svgTop: 0, stageH: svgH, head: null, plates: [] };
  }
  const groupW = span * sc + 18 + LW;
  const x0 = Math.max(0, Math.round((W - groupW) / 2));
  const cx = x0 + -VB.x * sc;
  const Rpx = (R.outer + 8) * sc;
  const hh = input.headHeight > 0 ? input.headHeight + 10 : 0;
  const items = plates
    .map((p) => {
      const an = pt(R.outer + 2, p.mid);
      return { key: p.key, h: p.height, ax: cx + an[0] * sc, ayRel: (-VB.y + an[1]) * sc, y: 0 };
    })
    .sort((a, b) => a.ayRel - b.ayRel);
  // Stack by the sector's height, never overlapping; the stage grows if it must.
  const total = items.reduce((t, it) => t + it.h + 6, -6) + hh;
  const Hs = Math.max(svgH, total);
  const dy = Math.max(0, (Hs - svgH) / 2);
  const cy = dy + -VB.y * sc;
  let y = hh;
  for (const it of items) {
    it.y = Math.max(y, it.ayRel + dy - it.h / 2);
    y = it.y + it.h + 6;
  }
  for (let i = items.length - 1, lim = Hs; i >= 0; i--) {
    if (items[i].y + items[i].h > lim) items[i].y = lim - items[i].h;
    lim = items[i].y - 6;
  }
  // The plates hug the rim: each stands just clear of the arc at its own height.
  const hug = (top: number, h: number): number => {
    const d = top < cy && top + h > cy ? 0 : Math.min(Math.abs(top - cy), Math.abs(top + h - cy));
    return d >= Rpx ? cx + 18 : cx + Math.sqrt(Rpx * Rpx - d * d) + 18;
  };
  const head = input.headHeight > 0 ? { x: Math.round(Math.min(W - LW, hug(0, input.headHeight))), y: 0 } : null;
  const placed: PlatePlace[] = items.map((it) => {
    const px = Math.min(W - LW, Math.round(hug(it.y, it.h)));
    const ey = it.y + Math.min(20, it.h / 2);
    return { key: it.key, x: px, y: Math.round(it.y), wire: { ex: px, ey, ax: it.ax, ay: it.ayRel + dy } };
  });
  return { wide, plateW: LW, svgW, svgH, scale: sc, svgLeft: x0, svgTop: Math.round(dy), stageH: Math.ceil(Hs), head, plates: placed };
}

export type HitDrawer = { key: string; a0: number; a1: number };
export type HitCard = { id: string; drawerKey: string; theta: number; pitch: number };

/** What a pointer at (clientX, clientY) over the dial's box is on: a drawer's sector, and the card under it
 *  when it is wide enough to aim at (otherwise the drawer is what is under the pointer). */
export function hitTest(
  box: { left: number; top: number; width: number; height: number },
  px: { x: number; y: number },
  drawers: readonly HitDrawer[],
  cards: readonly HitCard[],
): { drawerKey: string; cardId: string | null } | null {
  if (cards.length === 0) return null;
  const x = VB.x + ((px.x - box.left) / box.width) * VB.w;
  const y = VB.y + ((px.y - box.top) / box.height) * VB.h;
  const rad = Math.hypot(x, y);
  if (rad < R.cardIn - 6 || rad > R.outer + 6) return null;
  let th = (Math.atan2(x, -y) * 180) / Math.PI;
  if (th < 0) th += 360;
  const d = drawers.find((q) => th >= q.a0 && th <= q.a1);
  if (!d) return null;
  let best: HitCard | null = null;
  let bd = Infinity;
  for (const c of cards) {
    if (c.drawerKey !== d.key) continue;
    const dist = Math.abs(c.theta - th);
    if (dist < bd) {
      bd = dist;
      best = c;
    }
  }
  const aim = best !== null && bd <= Math.max(best.pitch / 2, 0.9) && best.pitch >= 2.2;
  return { drawerKey: d.key, cardId: aim && best ? best.id : null };
}
