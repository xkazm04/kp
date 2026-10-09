/*
 * The Loom's places and keyboard grammar (pure; pinned by loomNav.test.ts). The level machine is the
 * kit's levelStack (app/_components/kit/scene/levelStack.ts); this module names the Loom's places:
 *   L0 the loom · L1 one weft row pulled out (a dimension), opened on a member's knot or on none.
 * A sideways step (`[` `]`, or ← → outside controls that own their arrows) replaces the top.
 *
 * The weave's roving cursor: row -1 is the tags (the threads' names), rows 0..6 the weft; column -1
 * is the row labels (a weft's spool), columns 0..n-1 the threads. The tag row has no spool cell.
 */
import { levelReduce, type LevelAction } from "@/app/_components/kit/scene/levelStack.ts";
import { COHORT_DIMENSIONS, type CohortDimension } from "../../cohortTypes.ts";

export type LoomEntry = { level: 0 } | { level: 1; dimension: CohortDimension; focus: string | null };
export type LoomStack = readonly LoomEntry[];

export const LOOM_ROOT: LoomStack = [{ level: 0 }];

/** Two entries are the same place when they pull the same row (the member followed is not a place). */
export function sameLoomEntry(a: LoomEntry, b: LoomEntry): boolean {
  if (a.level !== b.level) return false;
  if (a.level === 1 && b.level === 1) return a.dimension === b.dimension;
  return true;
}

export function loomReduce(stack: LoomStack, action: LevelAction<LoomEntry>): LoomStack {
  return levelReduce(stack, action, { root: LOOM_ROOT, same: sameLoomEntry });
}

export function topOf(stack: LoomStack): LoomEntry {
  return stack[stack.length - 1] ?? LOOM_ROOT[0];
}

/** The next / previous weft row, wrapping (the loom has no first row to stop at). */
export function stepDimension(d: CohortDimension, delta: 1 | -1): CohortDimension {
  const i = COHORT_DIMENSIONS.indexOf(d);
  return COHORT_DIMENSIONS[(i + delta + COHORT_DIMENSIONS.length) % COHORT_DIMENSIONS.length];
}

/** A React key per layer: a sideways step keeps the instance (the pulled thread re-reads in place). */
export function layerKey(entry: LoomEntry, depth: number): string {
  return entry.level === 0 ? "loom" : `pulled:${depth}`;
}

/* ------------------------------------------------------------------ the weave's cursor */

export type Cursor = { row: number; col: number };

/**
 * One key on the weave. Arrows walk the grid (no wrap: an edge is an edge); Home / End jump to the
 * row's spool / last thread; on the tag row there is no spool, so Home lands on the first thread.
 * Returns null for a key the weave does not own.
 */
export function moveCursor(c: Cursor, key: string, rows: number, cols: number): Cursor | null {
  const minCol = (row: number) => (row < 0 ? 0 : -1);
  const fit = (row: number, col: number): Cursor => ({ row, col: Math.max(minCol(row), Math.min(cols - 1, col)) });
  switch (key) {
    case "ArrowRight":
      return fit(c.row, c.col + 1);
    case "ArrowLeft":
      return fit(c.row, c.col - 1);
    case "ArrowDown":
      return fit(Math.min(rows - 1, c.row + 1), c.col);
    case "ArrowUp":
      return fit(Math.max(-1, c.row - 1), c.col);
    case "Home":
      return fit(c.row, minCol(c.row));
    case "End":
      return fit(c.row, cols - 1);
    default:
      return null;
  }
}

/** The `data-loom-key` of the control at a cursor: `tag:<col>`, `row:<r>` or `knot:<r>:<col>`. */
export function cursorKey(c: Cursor): string {
  if (c.row < 0) return `tag:${c.col}`;
  if (c.col < 0) return `row:${c.row}`;
  return `knot:${c.row}:${c.col}`;
}

export function parseCursorKey(key: string | undefined | null): Cursor | null {
  if (!key) return null;
  const [kind, a, b] = key.split(":");
  const n = (s: string | undefined) => (s != null && /^\d+$/.test(s) ? Number(s) : null);
  if (kind === "tag" && n(a) != null) return { row: -1, col: n(a)! };
  if (kind === "row" && n(a) != null) return { row: n(a)!, col: -1 };
  if (kind === "knot" && n(a) != null && n(b) != null) return { row: n(a)!, col: n(b)! };
  return null;
}
