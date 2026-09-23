// What a pointer, a key or a drag MEANS on the Subway board - pure, so the rules
// are pinned by subwayInteraction.test.ts rather than by a browser.
//
// Two modes, one grammar (the retired card board's, PipelineCandidateRow.tsx):
//   - select mode: a bead is a checkbox, a station toggles its whole cell. Nothing
//     moves and nothing opens - in that mode the board is a selection surface.
//   - otherwise: a bead opens the candidate, and moves by drag OR by the "Move to"
//     menu (right-click, Shift+F10, the Menu key). Both inputs resolve through
//     `dropMove` and land in `commitDrop`, so the keyboard twin cannot decay into a
//     different rule than the pointer (registry: drag-drop / keyboard-alternatives).
//
// Legality is `moveTargetStages` (pipelineMoveTargets.ts) plus one board rule: a bead
// moves only along its OWN line - a station on another position is a different job,
// and a stage move never changes the job.

import type { StageDef } from "@/app/_lib/pipeline-stages";
import { entryLaneKey, type Entry } from "@/app/features/shared/pipelineTypes";
import { moveTargetStages } from "../../pipelineMoveTargets";

export type BoardMode = { selectMode: boolean };

/** A station the recruiter points at: which line (Position.id / entryLaneKey), which column. */
export type DropTarget = { positionId: string; stageId: string };

export type BeadIntent = { kind: "open" } | { kind: "toggle"; id: string };

/** A bead click: toggle it in select mode, open the candidate otherwise. */
export function beadIntent(mode: BoardMode, entry: Pick<Entry, "id">): BeadIntent {
  return mode.selectMode ? { kind: "toggle", id: entry.id } : { kind: "open" };
}

/** The bead's ARIA state: a checkbox (with its checked state) exactly in select
 *  mode; outside it the bead is a plain button and carries neither attribute. */
export function beadA11y(state: { selectMode: boolean; selected: boolean }): {
  role?: "checkbox";
  checked?: boolean;
} {
  return state.selectMode ? { role: "checkbox", checked: state.selected } : {};
}

export type CellSelectState = "none" | "some" | "all";

/** How much of a cell is selected. An empty cell is "none" - it has nothing to pick. */
export function cellSelectState(selected: ReadonlySet<string>, cell: readonly Pick<Entry, "id">[]): CellSelectState {
  if (cell.length === 0) return "none";
  let n = 0;
  for (const e of cell) if (selected.has(e.id)) n++;
  return n === 0 ? "none" : n === cell.length ? "all" : "some";
}

/** A station click in select mode: a partly (or un-) selected cell selects the rest,
 *  a fully selected one clears. Ids outside the cell are never added or removed, and
 *  the input set is never mutated (it is React state). */
export function toggleCellSelection(selected: ReadonlySet<string>, cell: readonly Pick<Entry, "id">[]): Set<string> {
  const next = new Set(selected);
  const on = cellSelectState(selected, cell) !== "all";
  for (const e of cell) {
    if (on) next.add(e.id);
    else next.delete(e.id);
  }
  return next;
}

/** May `entry` be dropped on `target`? Only a station on its own line, and only a
 *  column a manual set_stage can succeed into (never its own, never the terminal
 *  ROLE - a renamed "Placed" refuses exactly like "Hired"). */
export function canDropOn(
  entry: Pick<Entry, "stage" | "jobId" | "jobTitle">,
  target: DropTarget,
  axis: readonly StageDef[],
): boolean {
  if (entryLaneKey(entry) !== target.positionId) return false;
  return moveTargetStages(entry.stage, axis).includes(target.stageId);
}

export type BoardMove = { entry: Entry; toStage: string };

/** The ONE resolution both inputs share: the move a drop (or a menu pick) asks for,
 *  or null when it is refused. Off in select mode - a bead is a checkbox there, the
 *  card board's rule. */
export function dropMove(entry: Entry, target: DropTarget, axis: readonly StageDef[], mode: BoardMode): BoardMove | null {
  if (mode.selectMode) return null;
  if (!canDropOn(entry, target, axis)) return null;
  return { entry, toStage: target.stageId };
}

/** Resolve and perform: calls `onMove` (the board's optimistic, CAS-guarded
 *  moveEntry) exactly once for a legal move, never for a refused one. */
export function commitDrop(
  entry: Entry,
  target: DropTarget,
  axis: readonly StageDef[],
  mode: BoardMode,
  onMove: ((entry: Entry, toStage: string) => void) | undefined,
): boolean {
  if (!onMove) return false;
  const move = dropMove(entry, target, axis, mode);
  if (!move) return false;
  onMove(move.entry, move.toStage);
  return true;
}

export type MoveMenuItem = { id: string; label: string; target: DropTarget };

/** The "Move to" menu - the keyboard/right-click twin of the drag. Its items are
 *  `moveTargetStages` in axis order, each carrying the DropTarget the drag would
 *  have hit, so a pick goes through `commitDrop` like a drop does. A workspace's own
 *  column label wins; a shipped stage (label === id) resolves through `enumLabel`
 *  so it stays localized. */
export function moveMenuItems(
  entry: Entry,
  axis: readonly StageDef[],
  enumLabel: (stageId: string) => string = (id) => id,
): MoveMenuItem[] {
  const positionId = entryLaneKey(entry);
  return moveTargetStages(entry.stage, axis).map((id) => {
    const stage = axis.find((s) => s.id === id);
    const label = stage && stage.label !== stage.id ? stage.label : enumLabel(id);
    return { id, label, target: { positionId, stageId: id } };
  });
}
