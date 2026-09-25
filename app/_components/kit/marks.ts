/*
 * Mark geometry for the kit's everyday status marks (kit.js MK / MK_HOLLOW / MK_CLASS in the
 * One Measure winner). Meaning is carried by SHAPE; colour (kit.css .k-mark--*) is secondary.
 * Pure data, so the shape mapping is testable under node:test without a DOM.
 */
import type { MarkKind } from "./types.ts";

export type MarkShape =
  | { el: "circle"; cx: number; cy: number; r: number; fill?: boolean; sw?: number; dash?: string }
  | { el: "path"; d: string; fill?: boolean; sw?: number; join?: boolean }
  | { el: "rect"; x: number; y: number; w: number; h: number; rx: number; fill?: boolean; sw?: number };

const dot = (r: number): MarkShape => ({ el: "circle", cx: 8, cy: 8, r, fill: true });
const ring = (r: number, sw = 1.8): MarkShape => ({ el: "circle", cx: 8, cy: 8, r, sw });
const dashed: MarkShape = { el: "circle", cx: 8, cy: 8, r: 5, sw: 1.8, dash: "2.2 2.2" };

export const MARK_SHAPES: Record<MarkKind, MarkShape[]> = {
  ok: [dot(5)],
  wait: [ring(4.6)],
  needs: [{ el: "path", d: "M8 1.8 14.2 8 8 14.2 1.8 8Z", fill: true }],
  fail: [{ el: "path", d: "m3.5 3.5 9 9m0-9-9 9", sw: 2.4 }],
  bounce: [ring(5.6, 1.6), { el: "path", d: "m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8", sw: 1.8 }],
  recovered: [ring(5.2), dot(2.2)],
  unknown: [dashed],
  caution: [{ el: "path", d: "M8 2.2 14 13H2Z", sw: 1.7, join: true }],
  human: [dot(5)],
  machine: [{ el: "rect", x: 3.2, y: 3.2, w: 9.6, h: 9.6, rx: 1.5, fill: true }],
  nobody: [dashed],
};

/** A generated row's mark is hollow; only the actor kinds have a hollow form. */
const HOLLOW: Partial<Record<MarkKind, MarkShape[]>> = {
  human: [ring(4.6)],
  machine: [{ el: "rect", x: 3.6, y: 3.6, w: 8.8, h: 8.8, rx: 1.5, sw: 1.8 }],
};

/** Two kinds share another kind's colour class: a bounce is a failure, nobody is unknown. */
const CLASS_OF: Partial<Record<MarkKind, string>> = { bounce: "fail", nobody: "unknown" };

export function markShapes(kind: MarkKind, hollow = false): MarkShape[] {
  return (hollow && HOLLOW[kind]) || MARK_SHAPES[kind] || MARK_SHAPES.wait;
}

export function markClass(kind: MarkKind): string {
  return `k-mark k-mark--${CLASS_OF[kind] ?? kind}`;
}
