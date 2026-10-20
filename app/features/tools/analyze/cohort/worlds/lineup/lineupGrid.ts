/*
 * The Line-up's keyboard map (pure; pinned by lineupGrid.test.ts). The street is one roving tab stop over
 * a grid the reader walks with the arrows, exactly as it is drawn:
 *   rows 0..6  the tower (fit), then the six floors, top to bottom (STREET_ROWS)
 *   row 7      the name signs on the pavement (a press opens the member's full report)
 *   column 0   the floor directory in the left margin (a press walks that floor); it has no sign row
 *   columns 1..n  the buildings in street order
 * Left / Right walk along a floor, Up / Down climb a building, Home / End jump to the street's ends,
 * PageUp / PageDown to the roof and the pavement. No letters: the workspace owns its `g` chords.
 */
import { STREET_ROWS } from "./lineupModel.ts";

export const SIGN_ROW = STREET_ROWS.length;
export type GridCell = { row: number; col: number };

const lowestRow = (col: number) => (col === 0 ? SIGN_ROW - 1 : SIGN_ROW);

/** Keep a cell inside a street of `n` buildings (a cohort that shrank, a sign row with no directory). */
export function clampCell(at: GridCell, n: number): GridCell {
  const col = Math.max(0, Math.min(n, at.col));
  const row = Math.max(0, Math.min(lowestRow(col), at.row));
  return { row, col };
}

/**
 * The cell a key moves to, or null when the key is not the street's. At an edge the cell stays put
 * (the key is still the street's: it must not scroll the page).
 */
export function moveCell(at: GridCell, key: string, n: number): GridCell | null {
  const { row, col } = clampCell(at, n);
  switch (key) {
    case "ArrowLeft":
      return clampCell({ row, col: row === SIGN_ROW ? Math.max(1, col - 1) : col - 1 }, n);
    case "ArrowRight":
      return clampCell({ row, col: col + 1 }, n);
    case "ArrowUp":
      return clampCell({ row: row - 1, col }, n);
    case "ArrowDown":
      return clampCell({ row: Math.min(lowestRow(col), row + 1), col }, n);
    case "Home":
      return clampCell({ row, col: Math.min(1, n) }, n);
    case "End":
      return clampCell({ row, col: n }, n);
    case "PageUp":
      return clampCell({ row: 0, col }, n);
    case "PageDown":
      return clampCell({ row: lowestRow(col), col }, n);
    default:
      return null;
  }
}

/** The DOM handle of a cell (`data-lu-cell`), so focus can find the button the model moved to. */
export const cellKey = (c: GridCell): string => `${c.row}:${c.col}`;

export function parseCellKey(v: string | undefined): GridCell | null {
  const m = /^(\d+):(\d+)$/.exec(v ?? "");
  return m ? { row: Number(m[1]), col: Number(m[2]) } : null;
}
