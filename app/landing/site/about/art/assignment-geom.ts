/*
 * Pure geometry for the Assignment drawing (step 05), ported from the
 * prototype's about-art/s5-assignment.js. Strings only, no markup: the TSX
 * renders them. Shared helpers (r2, sparkPath, the gradient stop lists) are
 * also used by the Interview drawing.
 */

/** Round to two decimals, as the prototype's r2() (numbers print unchanged). */
export function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Four-point sparkle centred on (x, y), radius r: the `d` of one path. */
export function sparkPath(x: number, y: number, r: number): string {
  const k = r * 0.28;
  return (
    "M" + x + " " + r2(y - r) +
    "Q" + r2(x + k) + " " + r2(y - k) + " " + r2(x + r) + " " + y +
    "Q" + r2(x + k) + " " + r2(y + k) + " " + x + " " + r2(y + r) +
    "Q" + r2(x - k) + " " + r2(y + k) + " " + r2(x - r) + " " + y +
    "Q" + r2(x - k) + " " + r2(y - k) + " " + x + " " + r2(y - r) + "Z"
  );
}

/** A gradient stop: [offset, class that carries its stop-color]. */
export type Stop = readonly [number, string];

/** One linear or radial gradient of the hero, as the prototype declared it. */
export type Grad =
  | { kind: "lin"; key: string; x1: number; y1: number; x2: number; y2: number; stops: readonly Stop[] }
  | { kind: "rad"; key: string; cx: number; cy: number; r: number; stops: readonly Stop[] };

/** The specimen card's gradients, in the prototype's order. */
export const HERO_GRADS: readonly Grad[] = [
  { kind: "lin", key: "card", x1: 0.08, y1: 0, x2: 0.92, y2: 1, stops: [[0, "m-cream-0"], [0.5, "m-cream-1"], [1, "m-cream-2"]] },
  { kind: "lin", key: "mat", x1: 0.05, y1: 0, x2: 0.95, y2: 1, stops: [[0, "m-mat-0"], [0.55, "m-mat-1"], [1, "m-mat-2"]] },
  { kind: "rad", key: "shell", cx: 0.3, cy: 0.2, r: 0.9, stops: [[0, "m-coral-0"], [0.32, "m-coral-1"], [0.7, "m-coral-2"], [1, "m-coral-3"]] },
  { kind: "lin", key: "pron", x1: 0.1, y1: 0, x2: 0.9, y2: 1, stops: [[0, "m-steel-0"], [0.38, "m-steel-1"], [0.74, "m-steel-2"], [1, "m-steel-3"]] },
  { kind: "lin", key: "head", x1: 0.1, y1: 0, x2: 0.9, y2: 1, stops: [[0, "m-steel-1"], [0.5, "m-steel-2"], [1, "m-steel-3"]] },
  { kind: "lin", key: "brass", x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, "m-brass-0"], [0.35, "m-brass-1"], [0.75, "m-brass-2"], [1, "m-brass-3"]] },
  { kind: "rad", key: "ball", cx: 0.34, cy: 0.28, r: 0.8, stops: [[0, "m-brass-0"], [0.35, "m-brass-1"], [0.8, "m-brass-2"], [1, "m-brass-3"]] },
  { kind: "lin", key: "flag", x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, "m-brass-0"], [0.45, "m-brass-1"], [1, "m-brass-2"]] },
  { kind: "lin", key: "tape", x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, "m-tape-0"], [1, "m-tape-1"]] },
  { kind: "lin", key: "dot", x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, "m-coral-1"], [1, "m-coral-3"]] },
];

/** The chain links' silver gradient. */
export const CHAIN_STOPS: readonly Stop[] = [[0, "m-sil-0"], [0.5, "m-sil-1"], [1, "m-sil-2"]];

/** The beetle's leg polyline (left side; the right side mirrors it). */
export const LEG_L = "M-26 -26L-50 -42L-68 -30M-38 2L-64 -2L-80 14M-34 32L-58 42L-70 62";

/** Centres of the five chain links. */
export const CHAIN_CX = [20, 44, 68, 92, 116] as const;

/** Clip rect of the upper crossing between link k-1 and link k (k = 1..4). */
export function chainClip(k: number): { x: number; width: number } {
  const x = CHAIN_CX[k] - 16;
  return { x, width: CHAIN_CX[k - 1] + 16 - x };
}

/** One editor line: indent, its token segments [width in u, kind], and whether it carries the planted flaw. */
export type CodeLine = readonly [indent: number, segs: readonly (readonly [number, string])[], flaw?: 1];

export const CODE: readonly CodeLine[] = [
  [0, [[2.8, "k"], [4.6, "f"], [1.2, "p"]]],
  [1, [[2.4, "k"], [3.8, "i"], [1.2, "p"], [5.2, "s"]]],
  [1, [[4.6, "f"], [1.2, "p"], [3, "i"], [1.2, "p"], [1.8, "n"]]],
  [1, [[2.4, "k"], [3.2, "i"], [1.2, "p"], [4.8, "f"], [1.2, "p"]]],
  [2, [[3.8, "i"], [1.2, "p"], [4.6, "f"], [1.4, "p"]], 1],
  [2, [[2.8, "k"], [4.8, "i"], [1.6, "p"]]],
  [1, [[1.2, "p"]]],
  [0, []],
  [0, [[2.8, "k"], [4.2, "i"], [1.2, "p"], [6, "f"]]],
  [1, [[5.4, "f"], [1.2, "p"], [4.2, "s"]]],
  [1, [[2.4, "k"], [6.4, "i"]]],
  [0, [[1.2, "p"]]],
];

/** Widths of the four prompt pills, in %. */
export const PILL_W = [100, 80, 92, 62] as const;

/** Animation delay of prompt pill i, as the prototype's inline `--d`. */
export function pillDelay(i: number): string {
  return r2(0.55 + i * 0.13) + "s";
}
