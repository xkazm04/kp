/*
 * The district's map (pure data + curve maths). The stage is 1000 x 540 design units; every
 * building is a box on it and every road a cubic Bézier between two of them. The scene places
 * buttons by percentage of the stage and draws the roads in one SVG with the same viewBox, so
 * the two layers can never drift apart at any width.
 */
import type { NightNode } from "./channelsNightPlumbing.ts";

export const STAGE = { width: 1000, height: 540 } as const;

export type Box = { x: number; y: number; w: number; h: number };
export type BuildingId = NightNode | "houses";

export const BUILDINGS: Record<BuildingId, Box> = {
  careers: { x: 18, y: 12, w: 316, h: 104 },
  email: { x: 18, y: 128, w: 316, h: 104 },
  ads: { x: 18, y: 244, w: 316, h: 104 },
  feeds: { x: 18, y: 360, w: 316, h: 104 },
  edge: { x: 404, y: 2, w: 280, h: 116 },
  studio: { x: 420, y: 170, w: 236, h: 196 },
  book: { x: 414, y: 388, w: 352, h: 140 },
  relay: { x: 784, y: 92, w: 208, h: 216 },
  houses: { x: 806, y: 408, w: 186, h: 100 },
};

/** Road id -> [x0 y0 c1x c1y c2x c2y x1 y1]. `out` runs from the relay to the houses. */
export type RoadId = "careers" | "email" | "ads" | "feeds" | "edge" | "relay" | "out" | "book";
export const ROADS: Record<RoadId, readonly [number, number, number, number, number, number, number, number]> = {
  careers: [336, 64, 382, 64, 380, 214, 422, 222],
  email: [336, 180, 382, 180, 380, 246, 422, 250],
  ads: [336, 296, 382, 296, 380, 282, 422, 278],
  feeds: [422, 306, 380, 306, 384, 412, 336, 412],
  edge: [538, 118, 538, 140, 538, 150, 538, 172],
  relay: [656, 280, 700, 286, 740, 250, 806, 226],
  out: [886, 312, 886, 340, 886, 372, 886, 406],
  book: [538, 368, 538, 376, 538, 384, 538, 390],
};

export type Pt = { x: number; y: number };

export function cubicAt(p: readonly number[], t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6],
    y: u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7],
  };
}

/** The road's direction at t, in degrees (for a letter or a barrier lying along it). */
export function tangentAt(p: readonly number[], t: number): number {
  const a = cubicAt(p, Math.max(0, t - 0.02));
  const b = cubicAt(p, Math.min(1, t + 0.02));
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

export function roadPath(p: readonly number[]): string {
  return `M${p[0]} ${p[1]} C${p[2]} ${p[3]} ${p[4]} ${p[5]} ${p[6]} ${p[7]}`;
}

/** A box as CSS percentages of the stage (left / top / width); height follows the content. */
export function boxStyle(b: Box): { left: string; top: string; width: string; minHeight: string } {
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;
  return { left: pct(b.x, STAGE.width), top: pct(b.y, STAGE.height), width: pct(b.w, STAGE.width), minHeight: pct(b.h, STAGE.height) };
}

/** The four doors, top to bottom: one column that keeps its plates apart however tall a translation makes them. */
export const DOORS = ["careers", "email", "ads", "feeds"] as const;

/** The doors' column as CSS percentages of the stage: from the first door's top to the last one's bottom. */
export function doorsStyle(): { left: string; top: string; width: string; height: string } {
  const first = BUILDINGS[DOORS[0]];
  const last = BUILDINGS[DOORS[DOORS.length - 1]];
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;
  return { left: pct(first.x, STAGE.width), top: pct(first.y, STAGE.height), width: pct(first.w, STAGE.width), height: pct(last.y + last.h - first.y, STAGE.height) };
}

/** A point as CSS percentages of the stage. */
export function pointStyle(p: Pt): { left: string; top: string } {
  return { left: `${((p.x / STAGE.width) * 100).toFixed(2)}%`, top: `${((p.y / STAGE.height) * 100).toFixed(2)}%` };
}

/** Where the barrier stands on the relay road, and where the pile of held letters waits. */
export const BARRIER_T = 0.62;
export const PILE_T = 0.1;

/** Where the "start here" note pins beside a building (design units). */
export function notePoint(node: BuildingId): Pt {
  const b = BUILDINGS[node];
  if (node === "relay") return { x: b.x + 40, y: b.y - 34 };
  // left of the book, on the open hill under the pull feeds (above it sits the studio's plate)
  if (node === "book") return { x: b.x - 84, y: b.y + 88 };
  // a door: just right of its plate, over the start of its road (below it sits the next door)
  if (node === "careers" || node === "email" || node === "ads" || node === "feeds") return { x: b.x + b.w + 6, y: b.y + b.h - 44 };
  return { x: b.x + b.w / 2, y: b.y + b.h + 4 };
}
