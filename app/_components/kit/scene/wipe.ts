/*
 * The circle wipe between levels (pure geometry; pinned by wipe.test.ts). Lifted from the Night Post.
 *
 * A level OPENS as a circle growing from the element that was touched and CLOSES as the same
 * circle shrinking back onto it, so the reader always sees where a level came from and where it
 * returns. The layer animates `clip-path: circle(r at x y)` in its own box; this module computes
 * the point and the radius that covers the box, and the frames. Under reduced motion the layer
 * only cross-fades (the transform is dropped, not shortened: surface-doctrine §5).
 */

export type WipePoint = { x: number; y: number };
export type WipeBox = { width: number; height: number };
type RectLike = { left: number; top: number; width: number; height: number };

/** Open 760 ms on a decelerating curve, close 560 ms on an ease-in-out (the prototype's values). */
export const WIPE_OPEN = { ms: 760, easing: "cubic-bezier(.2,.8,.2,1)" } as const;
export const WIPE_CLOSE = { ms: 560, easing: "cubic-bezier(.6,0,.4,1)" } as const;
/** The reduced-motion stand-in: a short cross-fade, no geometry. */
export const WIPE_FADE_MS = 140;

/** The centre of `el` in the coordinates of `box` (the layer's own box); the top centre of the box
 *  when there is no element (a deep link arrives from nowhere on the page). */
export function wipeOrigin(box: RectLike, el: RectLike | null): WipePoint {
  if (!el) return { x: box.width / 2, y: Math.min(box.height / 2, 160) };
  return { x: el.left - box.left + el.width / 2, y: el.top - box.top + el.height / 2 };
}

/** The radius from `pt` to the farthest corner of the box, plus a margin, so the last frame
 *  covers everything and never leaves a sliver. */
export function wipeRadius(pt: WipePoint, box: WipeBox): number {
  const dx = Math.max(Math.abs(pt.x), Math.abs(box.width - pt.x));
  const dy = Math.max(Math.abs(pt.y), Math.abs(box.height - pt.y));
  return Math.ceil(Math.hypot(dx, dy)) + 12;
}

/** The two clip-path keyframes of a wipe, in order. */
export function wipeFrames(pt: WipePoint, box: WipeBox, dir: "open" | "close"): [string, string] {
  const at = `at ${Math.round(pt.x)}px ${Math.round(pt.y)}px`;
  const small = `circle(0px ${at})`;
  const big = `circle(${wipeRadius(pt, box)}px ${at})`;
  return dir === "open" ? [small, big] : [big, small];
}
