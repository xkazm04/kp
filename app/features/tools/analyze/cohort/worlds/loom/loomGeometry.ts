/*
 * The Loom's geometry (pure; pinned by loomGeometry.test.ts). One coordinate system in CSS pixels
 * for the SVG threads AND the HTML knots, tags and row labels laid over them, so the drawing and
 * the controls can never drift. The layout depends only on the width, the number of threads and
 * the order, never on the data: a pending thread that lands changes its paint, not its place.
 *
 *   y 0 .. TAG_H        the name tags, hanging at an angle from the beam
 *   beam                the top beam every warp hangs from
 *   rows                seven weft rows, ROW_PITCH apart
 *   fell .. clothEnd    the cloth: only the threads the narrative covers continue into it
 */

export const TAG_H = 132;
export const TAG_ANGLE = 58;
export const TAG_MAX = 150;
export const ROW_PITCH = 58;
export const FIRST_ROW_GAP = 40;
export const CLOTH_GAP = 34;
export const CLOTH_H = 30;
export const RIGHT = 30;
/** The gap a warp leaves above and below a row it passes behind. */
export const GAP = 12;
export const KNOT_H = { strong: 26, solid: 23, thin: 20, weak: 18, pending: 20 } as const;

export interface LoomGeo {
  width: number;
  height: number;
  gutter: number;
  pitch: number;
  /** The x of each column's warp. */
  xs: number[];
  beam: number;
  /** The y of each weft row. */
  ys: number[];
  fell: number;
  clothEnd: number;
  knotW: number;
  /** Each column's tag: the widest its words may run before the world's right edge. */
  tagMax: number[];
}

export function gutterFor(width: number): number {
  return width >= 1100 ? 196 : 172;
}

export function layoutLoom(width: number, columns: number, rows: number): LoomGeo {
  const gutter = gutterFor(width);
  const n = Math.max(1, columns);
  const pitch = Math.max(24, (width - gutter - RIGHT) / n);
  const xs = Array.from({ length: n }, (_, i) => gutter + pitch * (i + 0.5));
  const beam = TAG_H;
  const ys = Array.from({ length: rows }, (_, r) => beam + FIRST_ROW_GAP + r * ROW_PITCH);
  const fell = (ys[ys.length - 1] ?? beam) + CLOTH_GAP;
  const clothEnd = fell + CLOTH_H;
  const cos = Math.cos((TAG_ANGLE * Math.PI) / 180);
  // A tag runs up and to the right; the last ones are clipped to the width (the full name is on focus).
  const tagMax = xs.map((x) => Math.round(Math.max(48, Math.min(TAG_MAX, (width - x - 6) / cos))));
  return { width, height: clothEnd + 18, gutter, pitch, xs, beam, ys, fell, clothEnd, knotW: Math.round(Math.min(44, Math.max(22, pitch - 6))), tagMax };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A warp's path: one `M … Q …` segment per span (beam -> row 0 -> … -> last row -> end), so the
 * command structure is the same taut or slack (CSS can tween `d` between them). A span stops GAP
 * short of a row the thread passes behind. `slack` bows each span sideways, alternating.
 */
export function warpPath(x: number, geo: Pick<LoomGeo, "beam" | "ys">, end: number, behind: readonly boolean[], slack: number): string {
  const stops = [geo.beam, ...geo.ys, end];
  const parts: string[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i] + (i > 0 && behind[i - 1] ? GAP : 0);
    const to = stops[i + 1] - (i + 1 <= geo.ys.length && behind[i] ? GAP : 0);
    if (to <= from) continue;
    const bow = slack === 0 ? 0 : (i % 2 === 0 ? 1 : -1) * slack;
    parts.push(`M${r1(x)} ${r1(from)}Q${r1(x + bow)} ${r1((from + to) / 2)} ${r1(x)} ${r1(to)}`);
  }
  return parts.join("");
}

/** How far a slack (decoy) thread bows: enough to read as loose, never into the next thread. */
export function slackAmp(pitch: number): number {
  return r1(Math.min(9, pitch * 0.24));
}

/** A cut thread: a stub below the beam, and the two frayed ends of the cut. */
export function cutPaths(x: number, beam: number): { stub: string; fray: string } {
  const y = beam + 22;
  return {
    stub: `M${r1(x)} ${beam}L${r1(x)} ${y}`,
    fray: `M${r1(x - 4)} ${y + 3}L${r1(x)} ${y}L${r1(x + 4)} ${y + 4}M${r1(x - 3)} ${y + 10}L${r1(x)} ${y + 7}L${r1(x + 3)} ${y + 11}`,
  };
}

/**
 * The loose float over a row's noise group: arcs from knot to knot (left to right) lifted above the
 * row, so the members inside the noise read as tied together, never ranked. Null below two.
 */
export function floatPath(xs: readonly number[], y: number, knotH: number): string | null {
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const top = y - knotH / 2 - 3;
  let d = `M${r1(sorted[0])} ${r1(top)}`;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const lift = Math.min(26, 10 + (b - a) * 0.05);
    d += `Q${r1((a + b) / 2)} ${r1(top - lift)} ${r1(b)} ${r1(top)}`;
  }
  return d;
}

/** The selvedge along a leader's thread: two edge lines and the stitches binding them. */
export function selvedgePath(x: number, from: number, to: number): string {
  let d = `M${r1(x - 4)} ${from}L${r1(x - 4)} ${to}M${r1(x + 4)} ${from}L${r1(x + 4)} ${to}`;
  for (let y = from + 8; y < to - 4; y += 14) d += `M${r1(x - 4)} ${y}L${r1(x + 4)} ${y + 6}`;
  return d;
}

/** A tassel at the cut end of a thread that does not continue into the cloth. */
export function tasselPath(x: number, y: number): string {
  return `M${r1(x)} ${y}L${r1(x - 3)} ${y + 9}M${r1(x)} ${y}L${r1(x)} ${y + 10}M${r1(x)} ${y}L${r1(x + 3)} ${y + 9}`;
}

/** The weft of one row: from the label's spool to the tie-off. */
export function weftPath(geo: Pick<LoomGeo, "gutter" | "width">, y: number): string {
  return `M${geo.gutter - 10} ${y}L${geo.width - RIGHT + 14} ${y}`;
}
