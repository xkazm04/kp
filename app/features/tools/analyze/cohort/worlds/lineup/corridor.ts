/*
 * The Line-up's descent (pure geometry; pinned by corridor.test.ts). "Walk into one floor across every
 * building": the floor the reader pressed is a band across the whole street; the level below opens as
 * THAT band (a clip-path inset over the level's own box, so the floor's height and width are where the
 * corridor starts) growing until it is the page, and closes back into the band of the street it
 * returns to. A sideways step takes the stairs: the next floor slides in from below (down) or above (up).
 * Under reduced motion every one of them is a short cross-fade (the geometry is dropped, not shortened).
 */

export type Rect = { left: number; top: number; width: number; height: number };

/** Open 860 ms, close 600 ms (each in two legs, eased per leg below); the stairs 300 ms; reduced motion 140 ms. */
export const CORRIDOR_OPEN = { ms: 860, easing: "linear" } as const;
export const CORRIDOR_CLOSE = { ms: 600, easing: "linear" } as const;
const LEG_RUN = "cubic-bezier(.2,.8,.2,1)";
const LEG_OPEN = "cubic-bezier(.55,0,.2,1)";
export const STAIRS = { ms: 300, easing: "cubic-bezier(.2,.8,.2,1)", shift: 28 } as const;
export const CORRIDOR_FADE_MS = 140;
/** A WAAPI finish can be lost (a hidden tab, a cancelled frame): the level settles anyway after this. */
export const SETTLE_MARGIN_MS = 240;

const px = (n: number) => `${Math.max(0, Math.round(n))}px`;

/**
 * The band as an inset of the layer's box (`inset(top right bottom left round r)`). No band (a deep
 * arrival, a band scrolled away) = a thin strip across the layer's top, so the level still opens as a corridor.
 */
export function bandInset(layer: Rect, band: Rect | null, radius = 6): string {
  const b = band ?? { left: layer.left, top: layer.top, width: layer.width, height: Math.min(32, layer.height) };
  const top = b.top - layer.top;
  const left = b.left - layer.left;
  const right = layer.width - (left + b.width);
  const bottom = layer.height - (top + b.height);
  return `inset(${px(top)} ${px(right)} ${px(bottom)} ${px(left)} round ${radius}px)`;
}

export const FULL_INSET = "inset(0px 0px 0px 0px round 0px)";

/** Where the corridor turns: the band has run the full width of the level (a strip one floor high) and starts to open. */
export const CORRIDOR_TURN = 0.38;

/**
 * The three clip-path keyframes of a corridor, in order: the pressed floor's band, the same floor run out
 * across the level's whole width (the corridor), the whole level. A close plays them back.
 */
export function corridorFrames(layer: Rect, band: Rect | null, dir: "open" | "close"): Keyframe[] {
  const narrow = bandInset(layer, band);
  const b = band ?? { left: layer.left, top: layer.top, width: layer.width, height: Math.min(32, layer.height) };
  const strip = bandInset(layer, { left: layer.left, top: b.top, width: layer.width, height: b.height }, 0);
  // Each leg has its own curve (a keyframe's easing runs to the next one): the floor runs out quickly and
  // settles, then the corridor opens; closing, the page folds to the corridor and the corridor slides home.
  if (dir === "open") {
    return [
      { clipPath: narrow, offset: 0, easing: LEG_RUN },
      { clipPath: strip, offset: CORRIDOR_TURN, easing: LEG_OPEN },
      { clipPath: FULL_INSET, offset: 1 },
    ];
  }
  return [
    { clipPath: FULL_INSET, offset: 0, easing: LEG_OPEN },
    { clipPath: strip, offset: 1 - CORRIDOR_TURN, easing: LEG_RUN },
    { clipPath: narrow, offset: 1 },
  ];
}

/** The stairs: where the next floor's level starts (below when going down, above when going up). */
export function stairFrames(dir: 1 | -1): [Keyframe, Keyframe] {
  return [
    { opacity: 0, transform: `translateY(${dir * STAIRS.shift}px)` },
    { opacity: 1, transform: "translateY(0px)" },
  ];
}
