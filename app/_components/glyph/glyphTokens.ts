/**
 * Traced-hex → kp brand token mapping for /motionize glyphs.
 *
 * Pure logic, split out so it can be tested without rendering: `MotionizedGlyph`
 * paints `var(--color-…)` for every path instead of the raw traced hex, which is
 * what gives a single traced geometry both Studio Light and Spark Dark for free
 * and keeps the no-hardcoded-colors house rule intact.
 *
 * Matching is **hue-first**, deliberately. Image generators return pastel takes on
 * the requested hexes (a sage that should be `moss` comes back at #89A17E), and
 * nearest-RGB sends every one of those to `dial-stone` — the whole glyph greys
 * out. Hue survives the lightness drift, and lightness is exactly what the token
 * redefines per theme anyway.
 */

/** Accent tokens keyed by hue (Studio Light values). Ambient loops + glow ride these. */
const HUES: { token: string; hue: number }[] = [
  { token: "--color-coral", hue: 7 },
  { token: "--color-dial-amber", hue: 42 },
  { token: "--color-moss", hue: 114 },
  { token: "--color-steel", hue: 200 },
];
const ACCENT_TOKENS = new Set(HUES.map((h) => h.token));

export const rgb = (fill: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) return null; // already a var(--color-…) from the tracer's negative space
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Hue in degrees, chroma and lightness in 0..1.
 *
 * Chroma (max−min), not HSL saturation: at kp's paper lightness (0.96) a mere 15/255
 * spread reads as saturation 0.78, so an `s` threshold would classify the warm ground
 * as a coloured accent. Chroma says what it is — 0.06, i.e. almost neutral.
 */
export function hcl([r, g, b]: [number, number, number]): { h: number; c: number; l: number } {
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  const max = Math.max(R, G, B),
    min = Math.min(R, G, B),
    d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { h: 0, c: 0, l };
  const h = max === R ? 60 * (((G - B) / d + 6) % 6) : max === G ? 60 * ((B - R) / d + 2) : 60 * ((R - G) / d + 4);
  return { h, c: d, l };
}

/** Shortest distance between two hues on the colour wheel. */
export const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * Quantized trace hex → a kp brand token. Achromatic and extreme-lightness regions
 * resolve by role (ground / ink / muted structure / soft tint); anything with real
 * chroma resolves to the nearest accent hue. `accent` drives ambient loops + glow,
 * so structural line-work stays still.
 */
export function snapToToken(fill: string): { paint: string; accent: boolean } {
  const c = rgb(fill);
  if (!c) {
    // Already a token from the tracer (negative space → --color-paper).
    return { paint: fill, accent: [...ACCENT_TOKENS].some((t) => fill.includes(t)) };
  }
  const { h, c: chroma, l } = hcl(c);
  if (l > 0.88 && chroma < 0.12) return { paint: "var(--color-paper)", accent: false };
  if (l < 0.2) return { paint: "var(--color-ink)", accent: false };
  // A pale green tint is limewash, not a washed-out moss — it's a fill, not a mark.
  if (l > 0.78 && chroma < 0.25 && hueGap(h, 114) < 45) return { paint: "var(--color-limewash)", accent: false };
  if (chroma < 0.09) return { paint: "var(--color-dial-stone)", accent: false };
  let best = HUES[0]!;
  for (const t of HUES) if (hueGap(h, t.hue) < hueGap(h, best.hue)) best = t;
  return { paint: `var(${best.token})`, accent: true };
}
