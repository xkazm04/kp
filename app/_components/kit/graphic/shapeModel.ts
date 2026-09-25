/*
 * ShapeMark's pure half: the class a shape carries, and how a count of provenance kinds reads. No DOM,
 * no CSS import, so node:test reaches it.
 */
import type { ShapeKind, StageTone } from "../types";

/** The class list a shape carries: its kind, then its stage tone when it has one. */
export function shapeClass(shape: ShapeKind, tone?: StageTone): string {
  return `k-shp k-shp--${shape}${tone ? ` k-tone--${tone}` : ""}`;
}

/** Every shape kind, in the order a legend names them (observed first, absent last). */
export const SHAPE_ORDER: readonly ShapeKind[] = ["solid", "half", "ring", "dashed", "none", "exit"];
