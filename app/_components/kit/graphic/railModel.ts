/*
 * StageRail's and Lane's pure half: the fill a step draws, what its figure line shows, and where a
 * lane's path runs. No DOM, so node:test pins the maths the drawing depends on.
 */
import type { ShapeKind } from "../types";

export type RailStep = {
  id: string;
  label: string;
  /** How many reached this step; null = not loaded yet (renders "—", never 0). */
  reached: number | null;
  of: number | null;
  /** How many stopped here (the step is the furthest they got). */
  stopped?: number;
  /** Why this step can have nobody (hatched bar, "none", disabled). */
  absent?: string;
  tip?: string;
};

/** The bar's fill, 0..1: reached / of, clamped; nothing to divide by fills nothing. */
export function stepFill(s: Pick<RailStep, "reached" | "of">): number {
  if (!s.of || s.reached == null) return 0;
  return Math.max(0, Math.min(1, s.reached / s.of));
}

/** What the figure line under a step says. */
export type StepFigure = { kind: "unknown" } | { kind: "none" } | { kind: "fraction"; reached: number; of: number };
export function stepFigure(s: RailStep): StepFigure {
  if (s.reached == null) return { kind: "unknown" };
  if (s.absent) return { kind: "none" };
  return { kind: "fraction", reached: s.reached, of: s.of ?? s.reached };
}

/** A lane cell counts as reached unless it is "none" (never reached) or "dashed" (nothing on record). */
export const cellReached = (shape: ShapeKind) => shape !== "none" && shape !== "dashed";

/** The lane's path runs from the first reached cell to the last; no reached cell = no path. */
export function laneEnds(cells: readonly { shape: ShapeKind }[]): { first: number; last: number } | null {
  let first = -1;
  let last = -1;
  cells.forEach((c, i) => {
    if (!cellReached(c.shape)) return;
    if (first < 0) first = i;
    last = i;
  });
  return first < 0 ? null : { first, last };
}

/** The furthest reached index in a lane, -1 when nothing was reached (Journey's "stopped here"). */
export function furthestReached(cells: readonly { shape: ShapeKind }[]): number {
  return laneEnds(cells)?.last ?? -1;
}
