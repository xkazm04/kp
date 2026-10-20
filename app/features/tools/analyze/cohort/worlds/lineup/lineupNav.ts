/*
 * The Line-up's levels (pure; pinned by lineupNav.test.ts) on the kit's level stack
 * (app/_components/kit/scene/levelStack.ts pins the generic rules):
 *   L0 the street · L1 one floor walked across every building (a dimension), focused on a member or not.
 * A push walks into a floor, a pop comes back out onto the street, replaceTop takes the stairs to
 * another floor (the sideways step), and a member pressed in the corridor only re-aims the focus.
 */
import { levelReduce, type LevelAction } from "@/app/_components/kit/scene/levelStack.ts";
import type { CohortDimension } from "../../cohortTypes.ts";
import { STREET_ROWS } from "./lineupModel.ts";

export type LineupEntry = { level: 0 } | { level: 1; dimension: CohortDimension; focus: string | null };
export type LineupStack = readonly LineupEntry[];

export const LINEUP_ROOT: LineupStack = [{ level: 0 }];

/** Two entries are the same place when they walk the same floor (the focus is not a place). */
export function sameEntry(a: LineupEntry, b: LineupEntry): boolean {
  if (a.level === 0 || b.level === 0) return a.level === b.level;
  return a.dimension === b.dimension;
}

export function lineupReduce(stack: LineupStack, action: LevelAction<LineupEntry>): LineupStack {
  return levelReduce(stack, action, { root: LINEUP_ROOT, same: sameEntry });
}

export const topOf = (s: LineupStack): LineupEntry => s[s.length - 1] ?? LINEUP_ROOT[0];
export const depthOf = (s: LineupStack): number => Math.max(0, s.length - 1);

/** The floor a stack stands on, or null on the street. */
export const floorOf = (s: LineupStack): CohortDimension | null => {
  const top = topOf(s);
  return top.level === 1 ? top.dimension : null;
};

/** Which way the stairs go from one floor to another: +1 down (towards the street), -1 up (the roof). */
export function stairDirection(from: CohortDimension, to: CohortDimension): 1 | -1 {
  return STREET_ROWS.indexOf(to) >= STREET_ROWS.indexOf(from) ? 1 : -1;
}

/** A layer's React key: a new floor remounts its level; the street keeps its instance. */
export const layerKey = (e: LineupEntry, depth: number): string => (e.level === 0 ? "street" : `floor-${depth}-${e.dimension}`);
