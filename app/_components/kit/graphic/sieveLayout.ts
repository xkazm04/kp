/*
 * The Sieve's pure maths (no DOM, no React): which items stand in which layer, how many items one dot
 * stands for when the field is over budget, where each dot lands inside its layer's field, and the
 * pour's timing plan. The component (Sieve.tsx) measures the fields and draws; everything that can be
 * wrong without a browser lives here, where node:test reaches it.
 */
import type { ShapeKind, StageTone } from "../types";

export type SieveItem = { id: string; layer: string; shape: ShapeKind; tone?: StageTone; needs?: boolean };
/** One drawn dot: an item, or (over budget) the first item of a bin standing for `n` of them. */
export type SieveBin = SieveItem & { n: number };
export type SieveDot = { item: SieveBin; x: number; y: number };
/** A layer's field box, relative to the Sieve's own box. */
export type FieldBox = { left: number; top: number; height: number };

/** Dot pitch (px between centres) and radius, as the winner drew them. */
export const PITCH = 15;
export const dotRadius = (pitch: number = PITCH) => pitch * 0.34;

/** How many items one dot stands for: 1 until the items exceed the budget, then ceil(n / budget). */
export function itemsPerDot(count: number, budget = 400): number {
  return Math.max(1, Math.ceil(count / Math.max(1, budget)));
}

/** Dots per field line: at least 4, else as many whole pitches as the field is wide (2px inset each side). */
export function fieldColumns(width: number, pitch: number = PITCH): number {
  return Math.max(4, Math.floor((width - 4) / pitch));
}

/** Items grouped by layer in the caller's order; over budget each group is cut into bins of `per`. */
export function groupByLayer(layerIds: readonly string[], items: readonly SieveItem[], per: number): Record<string, SieveBin[]> {
  const groups: Record<string, SieveItem[]> = {};
  for (const id of layerIds) groups[id] = [];
  for (const it of items) (groups[it.layer] ??= []).push(it);
  const out: Record<string, SieveBin[]> = {};
  for (const [k, g] of Object.entries(groups)) {
    if (per <= 1) {
      out[k] = g.map((it) => ({ ...it, n: 1 }));
      continue;
    }
    const bins: SieveBin[] = [];
    for (let i = 0; i < g.length; i += per) bins.push({ ...g[i], n: Math.min(per, g.length - i) });
    out[k] = bins;
  }
  return out;
}

/** Items per layer (the fig track's count), counting every item, never bins. */
export function countByLayer(layerIds: readonly string[], items: readonly SieveItem[]): Record<string, number> {
  const per: Record<string, number> = {};
  for (const id of layerIds) per[id] = 0;
  for (const it of items) per[it.layer] = (per[it.layer] ?? 0) + 1;
  return per;
}

/** A field's height: one pitch per line of dots plus 6px air, never under the 24px row floor. */
export function fieldHeight(dots: number, cols: number, pitch: number = PITCH): number {
  return Math.max(24, Math.ceil(dots / cols) * pitch + 6);
}

/** Dot centres: row-major inside each field, the block of lines centred vertically in its field. */
export function placeDots(groups: Record<string, SieveBin[]>, boxes: Record<string, FieldBox>, cols: number, pitch: number = PITCH): SieveDot[] {
  const dots: SieveDot[] = [];
  for (const [k, g] of Object.entries(groups)) {
    const f = boxes[k];
    if (!f) continue;
    const y0 = f.top + (f.height - Math.ceil(g.length / cols) * pitch) / 2;
    g.forEach((item, i) => {
      dots.push({ item, x: f.left + (i % cols) * pitch + pitch / 2, y: y0 + Math.floor(i / cols) * pitch + pitch / 2 });
    });
  }
  return dots;
}

/** Fold order inside a layer: walked first, then uncertain, exits, placed, nothing on record. */
const FOLD: Record<ShapeKind, number> = { solid: 0, half: 1, exit: 2, ring: 3, dashed: 4, none: 5 };
export function foldOrder<T extends { shape: ShapeKind }>(items: readonly T[], rank: (it: T) => number): T[] {
  return items.slice().sort((a, b) => FOLD[a.shape] - FOLD[b.shape] || rank(a) - rank(b));
}

/*
 * The pour. Solid, half and exit dots FALL from the pour line in order and land on their layer (they
 * walked there); ring dots POP in place (they were placed there); dashed dots FADE in last (nothing on
 * record). ~850 ms in all, once per replay key.
 */
export type PourStep = { index: number; kind: "fall" | "pop" | "fade"; delay: number; dur: number };
export function pourPlan(dots: readonly { item: { shape: ShapeKind } }[]): PourStep[] {
  const fallers: number[] = [];
  const poppers: number[] = [];
  dots.forEach((d, i) => (d.item.shape === "solid" || d.item.shape === "half" || d.item.shape === "exit" ? fallers : poppers).push(i));
  const plan: PourStep[] = [];
  fallers.forEach((index, k) => plan.push({ index, kind: "fall", delay: fallers.length > 1 ? k * (430 / fallers.length) : 0, dur: 420 }));
  poppers.forEach((index, k) =>
    plan.push({ index, kind: dots[index].item.shape === "dashed" ? "fade" : "pop", delay: 320 + (poppers.length > 1 ? k * (300 / poppers.length) : 0), dur: 240 })
  );
  return plan;
}

/** The fall's ease (accelerating, a slight overshoot-free landing) and the pop's 1.18 swell. */
export const fallEase = (t: number) => t * t * (1.6 - 0.6 * t);
export const popScale = (t: number) => (t < 0.7 ? (t / 0.7) * 1.18 : 1.18 - ((t - 0.7) / 0.3) * 0.18);

/** The whole pour's length for a plan (the last step's end), for tests and the frame-cost probe. */
export function pourDuration(plan: readonly PourStep[]): number {
  return plan.reduce((m, p) => Math.max(m, p.delay + p.dur), 0);
}
