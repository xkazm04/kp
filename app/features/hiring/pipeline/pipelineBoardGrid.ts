// Board grid geometry, derived from the stage COUNT so it can never drift out of
// sync with the columns actually rendered. A hardcoded grid-cols repeat(7) +
// min-w-[2240px] previously painted two empty phantom columns after the 7→5 stage
// consolidation; computing both from the count makes the board self-adjust.
//
// Now a function of the count rather than a module constant: the axis is
// per-workspace data, so "how many columns" is a runtime answer and a frozen
// style object would silently paint the default board's geometry under a team
// that added a column. Split out of PipelineBoard.tsx.

export const CELL_LIMIT = 6;
export const EMPTY_SELECTION: ReadonlySet<string> = new Set();

export const POSITION_COL = 240; // px — the sticky leading "Position" column
export const STAGE_COL = 280; // px — the min width of each stage column

/** The grid template for a board of `stageCount` columns (plus the sticky
 *  leading position column). */
export function boardGrid(stageCount: number): React.CSSProperties {
  return { gridTemplateColumns: `${POSITION_COL}px repeat(${stageCount}, minmax(${STAGE_COL}px, 1fr))` };
}

/** The scroll container's min width for `stageCount` columns. */
export function boardMinWidth(stageCount: number): React.CSSProperties {
  return { minWidth: POSITION_COL + stageCount * STAGE_COL };
}
