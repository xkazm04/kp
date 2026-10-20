/*
 * Pure geometry for the Interview drawing (step 06), ported from the
 * prototype's about-art/s6-interview.js. Strings and numbers only; the TSX
 * renders them.
 */
import { r2, type Grad } from "./assignment-geom";

export { r2, sparkPath } from "./assignment-geom";

/** Arc path along a circle, angles in degrees (0 = 3 o'clock, clockwise on screen). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = [cx + r * Math.cos((a0 * Math.PI) / 180), cy + r * Math.sin((a0 * Math.PI) / 180)];
  const q = [cx + r * Math.cos((a1 * Math.PI) / 180), cy + r * Math.sin((a1 * Math.PI) / 180)];
  return "M" + r2(p[0]) + " " + r2(p[1]) + "A" + r + " " + r + " 0 0 " + (a1 > a0 ? 1 : 0) + " " + r2(q[0]) + " " + r2(q[1]);
}

/** The headphones' gradients, in the prototype's order. */
export const HERO_GRADS: readonly Grad[] = [
  { kind: "lin", key: "band", x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, "k-steel-0"], [0.4, "k-steel-1"], [0.78, "k-steel-2"], [1, "k-steel-3"]] },
  { kind: "rad", key: "cup", cx: 0.3, cy: 0.22, r: 0.95, stops: [[0, "k-coral-0"], [0.3, "k-coral-1"], [0.68, "k-coral-2"], [1, "k-coral-3"]] },
  { kind: "lin", key: "pad", x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, "k-cream-0"], [0.5, "k-cream-1"], [1, "k-cream-2"]] },
  { kind: "rad", key: "plate", cx: 0.32, cy: 0.26, r: 0.85, stops: [[0, "k-brass-0"], [0.35, "k-brass-1"], [0.78, "k-brass-2"], [1, "k-brass-3"]] },
  { kind: "lin", key: "cable", x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, "k-cream-0"], [0.55, "k-cream-1"], [1, "k-cream-2"]] },
  { kind: "lin", key: "plug", x1: 0, y1: 0, x2: 1, y2: 0, stops: [[0, "k-sil-0"], [0.5, "k-sil-1"], [1, "k-sil-2"]] },
];

/** The soundwave arcs around the inner cup: [class, d, stroke width]. */
export const WAVES: readonly (readonly [string, string, string])[] = [
  ["k-w k-w1 s-wave", arcPath(232, 172, 27, -46, 46), "8"],
  ["k-w k-w2 s-wave", arcPath(232, 172, 41, -42, 42), "7"],
  ["k-w k-w3 s-wave", arcPath(232, 172, 55, -38, 38), "6"],
];

/** Curled cable from the outer cup down to the jack plug. */
export const COIL = "M41 218C41 240 66 246 82 236C98 226 84 212 71 222C58 232 70 250 96 246C118 243 126 230 116 222";

/** The 30 waveform bars: --h (entry height) and --h2 (breathing height). */
export const WAVE_BARS: readonly { h: number; h2: number }[] = Array.from({ length: 30 }, (_, i) => ({
  h: r2(0.2 + 0.8 * Math.abs(Math.sin(i * 1.37) * Math.cos(i * 0.51 + 0.4))),
  h2: r2(Math.min(1, 0.16 + 0.84 * Math.abs(Math.cos(i * 0.93 + 1.1) * Math.sin(i * 0.37)))),
}));

/** The scorecard ticket's rows: dots on (of SCORE_MAX) and the label bar's width in %. */
export const SCORES = [4, 3, 5, 4] as const;
export const SCORE_BAR_W = [58, 72, 50, 64] as const;
export const SCORE_MAX = 5;

/** The thermal ticket's torn bottom edge, as a clip-path polygon. */
export function zigzag(): string {
  const n = 26;
  const pts = ["0 0", "100% 0"];
  for (let i = n; i >= 0; i--) pts.push(r2((i * 100) / n) + "% " + (i % 2 ? "calc(100% - var(--tooth))" : "100%"));
  return "polygon(" + pts.join(",") + ")";
}
