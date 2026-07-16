import { entryLaneKey, STAGES, type Entry, type Position } from "./PipelineTypes";

// Board-grid bucketing, pulled out of PipelineBoard so it's computed ONCE per
// render (a memoized single pass) instead of re-filtering the whole entry list
// per position × stage cell — the old inline `lane.filter(...)` inside the
// STAGES.map was O(positions × entries × stages) every render. Pure + DB-free, so
// the fold rule (below) is unit-tested in isolation.

/** Bucket entries into a lane → per-stage-column grid.
 *
 *  The return is keyed by lane id (Position.id / entryLaneKey); each value is an
 *  array indexed by STAGES position, so `cells[laneKey][stageIndex]` is the entry
 *  list for that cell. Every entry lands in EXACTLY ONE cell:
 *    - its stage's column when the stage is a known board column, else
 *    - the FIRST column (index 0) when its stage isn't one — a legacy/unmapped
 *      stage stays visible + actionable rather than vanishing while still counted.
 *  Order within a cell follows the input order (entries is already globally
 *  ordered by the caller). An entry whose lane isn't among `positions` is dropped
 *  (it belongs to a lane the filtered board isn't rendering). */
export function bucketLaneEntries(positions: Position[], entries: Entry[]): Map<string, Entry[][]> {
  const map = new Map<string, Entry[][]>();
  for (const pos of positions) map.set(pos.id, STAGES.map(() => [] as Entry[]));
  for (const e of entries) {
    const cells = map.get(entryLaneKey(e));
    if (!cells) continue;
    const known = STAGES.indexOf(e.stage);
    cells[known >= 0 ? known : 0].push(e);
  }
  return map;
}

/** Flatten the board grid into the recruiter's VISIBLE reading sequence:
 *  lane by lane (in `positions` order — the board's rendered lane order), and
 *  within each lane column by column (STAGES order), preserving each cell's own
 *  within-cell order. This is exactly what `bucketLaneEntries` lays out, read
 *  top-to-bottom / left-to-right, so the drawer's prev/next walks what the eye
 *  walks instead of the global filtered sort (which crosses stage boundaries
 *  mid-column-review). Entries whose lane isn't among `positions` are dropped,
 *  matching the board — the same fold `bucketLaneEntries` applies. */
export function boardVisibleOrder(positions: Position[], entries: Entry[]): Entry[] {
  const cells = bucketLaneEntries(positions, entries);
  const out: Entry[] = [];
  for (const pos of positions) {
    const laneCells = cells.get(pos.id);
    if (!laneCells) continue;
    for (const cell of laneCells) for (const e of cell) out.push(e);
  }
  return out;
}
