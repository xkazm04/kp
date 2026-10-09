/*
 * The Loom's descent, "pull one weft thread out" (pure geometry; pinned by loomPull.test.ts).
 *
 * Open: the pressed row's knots LIFT out of the weave as one ghost row and travel to where the
 * pulled row sits at the top of the dimension page (a FLIP: the ghost is laid out at the page's
 * row and transformed back onto the loom's row, then released); the page then UNRAVELS out of that
 * thread, a clip opening from a line at the row's height to the whole level. Close is the reverse:
 * the page winds back into its thread, and the thread is laid back into the loom where it came from.
 * A sideways step slides the page from the row above or below. Reduced motion: a cross-fade only.
 */

export type Rect = { left: number; top: number; width: number; height: number };

export const PULL = {
  liftMs: 380,
  openDelay: 260,
  openMs: 620,
  fadeMs: 180,
  closeMs: 440,
  returnMs: 380,
  swapMs: 240,
  fadeOnlyMs: 140,
  /** The settle timer: every transition ends by then even if an animation never reports. */
  maxMs: 1500,
  ease: "cubic-bezier(.2,.8,.2,1)",
  easeIn: "cubic-bezier(.6,0,.4,1)",
} as const;

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

/**
 * The band of the loom's row as the ghost must cover it: n columns wide, centred on the first and
 * last knot cells, `height` tall around `centerY`. One column when there is only one thread.
 */
export function rowBand(first: Rect, last: Rect, n: number, centerY: number, height: number): Rect {
  const c0 = first.left + first.width / 2;
  const c1 = last.left + last.width / 2;
  const pitch = n > 1 ? (c1 - c0) / (n - 1) : first.width;
  return { left: c0 - pitch / 2, top: centerY - height / 2, width: pitch * n, height };
}

/** The transform (origin: left centre) that lays a box at `to` over the box at `from`. */
export function flipTransform(from: Rect, to: Rect): string {
  const sx = to.width > 0 ? from.width / to.width : 1;
  const dx = from.left - to.left;
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${px(dx)}, ${px(dy)}) scale(${Math.round(sx * 1000) / 1000}, 1)`;
}

/** A layer of height `h` clipped down to the line at `y` (its own coordinates): the thread before it unravels. */
export function lineClip(y: number, h: number): string {
  const top = Math.max(0, Math.min(h, y));
  return `inset(${px(top)} 0px ${px(Math.max(0, h - top))} 0px)`;
}

export const FULL_CLIP = "inset(0px 0px 0px 0px)";

/** The sideways step's frames: the next row (below, +1) rises into place, the previous one drops in. */
export function swapFrames(dir: 1 | -1, reduced: boolean): Keyframe[] {
  if (reduced) return [{ opacity: 0 }, { opacity: 1 }];
  return [
    { opacity: 0, transform: `translateY(${dir * 18}px)` },
    { opacity: 1, transform: "none" },
  ];
}
