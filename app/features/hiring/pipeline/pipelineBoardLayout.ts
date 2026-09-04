import { entryLaneKey, STAGES, type Entry, type Position } from "@/app/features/shared/pipelineTypes";
import { CELL_LIMIT } from "./pipelineBoardGrid";

/** The column ids a board is rendering. Defaults to the shipped axis so the
 *  many existing call sites (and the tests) keep working unchanged; the board
 *  passes the workspace's resolved axis. */
export type BoardColumns = readonly string[];

// Board-grid bucketing, pulled out of PipelineBoard so it's computed ONCE per
// render (a memoized single pass) instead of re-filtering the whole entry list
// per position × stage cell — the old inline `lane.filter(...)` inside the
// STAGES.map was O(positions × entries × stages) every render. Pure + DB-free, so
// the fold rule (below) is unit-tested in isolation.

/** Bucket entries into a lane → per-stage-column grid.
 *
 *  The return is keyed by lane id (Position.id / entryLaneKey); each value is an
 *  array indexed by `columns` position, so `cells[laneKey][stageIndex]` is the
 *  entry list for that cell. Order within a cell follows the input order (entries
 *  is already globally ordered by the caller). An entry whose lane isn't among
 *  `positions` is dropped (it belongs to a lane the filtered board isn't
 *  rendering).
 *
 *  An entry whose stage is NOT one of `columns` lands in no cell at all — see
 *  `offAxisEntries` below. It used to be folded into column 0, which was the
 *  right call when the axis was a compile-time constant and an unknown stage
 *  could only be a legacy row: better visible-and-wrong than invisible. Under an
 *  EDITABLE axis that fold becomes actively dangerous — remove a column and its
 *  candidates would silently reappear at the top of the funnel, looking for all
 *  the world like they had been reset. They are surfaced deliberately instead. */
export function bucketLaneEntries(
  positions: Position[],
  entries: Entry[],
  columns: BoardColumns = STAGES
): Map<string, Entry[][]> {
  const map = new Map<string, Entry[][]>();
  for (const pos of positions) map.set(pos.id, columns.map(() => [] as Entry[]));
  for (const e of entries) {
    const cells = map.get(entryLaneKey(e));
    if (!cells) continue;
    const known = columns.indexOf(e.stage);
    if (known >= 0) cells[known].push(e);
  }
  return map;
}

/** Entries whose stage is not a column on this board — a candidate standing on a
 *  RETIRED stage, or on one no axis knows at all. The board renders these in
 *  their own strip so "where did they go?" is never the answer to removing a
 *  column. Preserves input order. */
export function offAxisEntries(entries: Entry[], columns: BoardColumns = STAGES): Entry[] {
  return entries.filter((e) => !columns.includes(e.stage));
}

/** Flatten the board grid into the recruiter's VISIBLE reading sequence:
 *  lane by lane (in `positions` order — the board's rendered lane order), and
 *  within each lane column by column, preserving each cell's own within-cell
 *  order. This is exactly what `bucketLaneEntries` lays out, read top-to-bottom /
 *  left-to-right, so the drawer's prev/next walks what the eye walks instead of
 *  the global filtered sort (which crosses stage boundaries mid-column-review).
 *  Entries whose lane isn't among `positions` are dropped, matching the board.
 *
 *  Off-axis entries trail the grid rather than being dropped: they ARE on screen
 *  (in the off-axis strip), so prev/next must be able to reach them — a candidate
 *  you can see but cannot step to reads as a broken control. */
export function boardVisibleOrder(positions: Position[], entries: Entry[], columns: BoardColumns = STAGES): Entry[] {
  const cells = bucketLaneEntries(positions, entries, columns);
  const out: Entry[] = [];
  for (const pos of positions) {
    const laneCells = cells.get(pos.id);
    if (!laneCells) continue;
    for (const cell of laneCells) for (const e of cell) out.push(e);
  }
  const lanes = new Set(positions.map((p) => p.id));
  for (const e of offAxisEntries(entries, columns)) if (lanes.has(entryLaneKey(e))) out.push(e);
  return out;
}

// Group entries into position lanes (job id ?? title ?? "?"), sorted by title.
// Pulled out so it can run over BOTH the full board (the position count) and the
// filtered board (the lanes actually rendered) without duplicating the keying —
// which must match the lane key used above (entryLaneKey).
export function groupPositions(entries: Entry[]): Position[] {
  const map = new Map<string, Position>();
  for (const e of entries) {
    const key = entryLaneKey(e);
    if (!map.has(key)) map.set(key, { id: key, title: e.jobTitle ?? "—", family: e.roleFamily ?? "", count: 0 });
    map.get(key)!.count += 1;
  }
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** The visible slice of a capped list plus how many it is hiding — the arithmetic
 *  behind every "+N more" affordance on the board.
 *
 *  It exists because the OFF-AXIS STRIP was the one list on the board with no
 *  ceiling: a stage cell caps at CELL_LIMIT and offers an expand toggle, but
 *  retiring a busy column dumped every stranded card into the strip at once —
 *  precisely the moment the list is longest (a column is usually retired because
 *  it held people). The two now share one constant and one rule, so the board
 *  cannot grow a third, differently-behaved cap.
 *
 *  `limit` is the cap; passing a non-positive limit means "no cap" (everything
 *  visible, overflow 0) rather than an empty list. `overflow` is never negative,
 *  so the caller can use `overflow > 0` as its render condition. */
export function cappedWithOverflow<T>(
  items: readonly T[],
  expanded: boolean,
  limit: number = CELL_LIMIT
): { visible: T[]; overflow: number } {
  if (limit <= 0 || expanded || items.length <= limit) return { visible: items.slice(), overflow: 0 };
  return { visible: items.slice(0, limit), overflow: items.length - limit };
}
