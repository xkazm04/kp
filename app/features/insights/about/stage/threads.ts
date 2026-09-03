import { r2, type Point, type Rect } from "./stages";

/*
 * Connector geometry for the deck's register: a claim on one side, its
 * evidence on the other, a drawn thread between them.
 *
 * Extracted from chapter 1 once a second chapter needed the same curve. All of
 * it is pure and derived from the same percent rects the boxes are drawn from,
 * so a layout tweak can never leave a thread pointing at empty space — the one
 * failure that makes a diagram like this read as broken rather than as alive.
 *
 * Coordinates are percent-of-field in each axis, matching the unlocked viewBox
 * the `Wires` layer declares (`viewBox="0 0 100 100"`,
 * `preserveAspectRatio="none"`). A number here and a CSS percent are the same
 * place.
 */

/** Right edge, vertically centred — where a thread leaves an evidence card. */
export const rightOf = (r: Rect): Point => ({ x: r.x + r.w, y: r.y + r.h / 2 });

/** Left edge, vertically centred — where a thread meets a claim row. */
export const leftOf = (r: Rect): Point => ({ x: r.x, y: r.y + r.h / 2 });

/** Bottom edge at a fraction across — for a thread that drops into something. */
export const bottomOf = (r: Rect, at = 0.5): Point => ({ x: r.x + r.w * at, y: r.y + r.h });

/** Top edge at a fraction across. */
export const topOf = (r: Rect, at = 0.5): Point => ({ x: r.x + r.w * at, y: r.y });

/*
 * ── Path memo ───────────────────────────────────────────────────────────────
 *
 * `sCurve`/`vCurve` are called from render, and a scene re-renders on every
 * 900ms beat for as long as it is on screen — chapter 1 alone rebuilds six
 * cubic-bezier strings (six `r2` rounds and a template literal each) 15 times a
 * loop, forever, to produce the SAME six strings it produced last beat. The
 * geometry is module-level constants; only the phase changes.
 *
 * So: a pure-function cache keyed on the exact arguments. Three properties make
 * it safe rather than clever —
 *
 *   - The functions are total and deterministic over numbers, so a hit is
 *     indistinguishable from a call. There is no clock, no locale, no `this`.
 *   - The key is the RAW inputs, never the rounded ones. `r2` is applied to
 *     intermediate control points, so two inputs that round alike can still
 *     produce different paths; keying on rounded values would serve one scene
 *     another's curve.
 *   - The boundary is stated below rather than assumed.
 *
 * BOUNDARY: one module-level Map, process-lifetime, capped at MAX_PATHS. Every
 * caller in the deck passes constants, so the live set is a few dozen entries
 * and the cap is never approached — it exists for the case this module is ever
 * called with derived geometry (a resize-driven layout, a data-driven fan), so
 * a leak is impossible by construction rather than by convention. At the cap
 * the whole map is dropped instead of evicting an entry: the next few beats
 * rebuild the working set at the cost of one render, and an LRU here would be
 * more machinery than the thing it protects. NOT for user-supplied input — the
 * key is a joined number list and nothing in it is escaped.
 */
const MAX_PATHS = 512;
const PATHS = new Map<string, string>();

function memoPath(key: string, build: () => string): string {
  const hit = PATHS.get(key);
  if (hit !== undefined) return hit;
  const made = build();
  if (PATHS.size >= MAX_PATHS) PATHS.clear();
  PATHS.set(key, made);
  return made;
}

/**
 * A horizontal S-curve from `from` to `to`.
 *
 * `bow` is how far the control points push out along x, as a fraction of the
 * run. Around 0.55 reads as a deliberate routed line; flatten it toward 0 and a
 * fan of these collapses into a bundle of straight wire that no longer reads as
 * separate claims each finding their own source.
 */
export function sCurve(from: Point, to: Point, bow = 0.55): string {
  return memoPath(`s|${from.x}|${from.y}|${to.x}|${to.y}|${bow}`, () => {
    const dx = (to.x - from.x) * bow;
    return `M ${r2(from.x)} ${r2(from.y)} C ${r2(from.x + dx)} ${r2(from.y)}, ${r2(to.x - dx)} ${r2(to.y)}, ${r2(to.x)} ${r2(to.y)}`;
  });
}

/**
 * A vertical S-curve — for stacked stages where work flows downward.
 *
 * `MIN_RUN` is a curvature floor: below it the curve flattens into a straight
 * drop and two adjacent connectors become indistinguishable.
 */
const MIN_RUN = 8;

export function vCurve(from: Point, to: Point, bow = 0.5): string {
  return memoPath(`v|${from.x}|${from.y}|${to.x}|${to.y}|${bow}`, () => {
    const run = Math.max(to.y - from.y, MIN_RUN);
    const dy = run * bow;
    return `M ${r2(from.x)} ${r2(from.y)} C ${r2(from.x)} ${r2(from.y + dy)}, ${r2(to.x)} ${r2(to.y - dy)}, ${r2(to.x)} ${r2(to.y)}`;
  });
}

/**
 * Authored asymmetry — a small, DETERMINISTIC per-index jitter.
 *
 * A fan of geometrically identical arcs reads as a machine stamping parts. A
 * couple of degrees of variation reads as separate pieces of work. It must not
 * be random: the scenes re-render constantly and a `Math.random()` here would
 * make every thread twitch on each tick.
 */
const WOBBLE = [0.52, 0.61, 0.47, 0.58, 0.5, 0.64, 0.55] as const;

export const bowFor = (i: number): number => WOBBLE[i % WOBBLE.length];
