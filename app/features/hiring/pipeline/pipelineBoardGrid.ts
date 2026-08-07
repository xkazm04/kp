// Board grid geometry, derived from the stage list so it can never drift out of
// sync with STAGES. A hardcoded grid-cols repeat(7) + min-w-[2240px] previously
// painted two empty phantom columns after the 7→5 stage consolidation; computing
// both from STAGES.length makes the board self-adjust to any future stage add/
// remove. Split out of PipelineBoard.tsx.

import { STAGES } from "@/app/features/shared/pipelineTypes";

export const CELL_LIMIT = 6;
export const EMPTY_SELECTION: ReadonlySet<string> = new Set();

export const POSITION_COL = 240; // px — the sticky leading "Position" column
export const STAGE_COL = 280; // px — the min width of each stage column
export const BOARD_GRID: React.CSSProperties = {
  gridTemplateColumns: `${POSITION_COL}px repeat(${STAGES.length}, minmax(${STAGE_COL}px, 1fr))`,
};
export const BOARD_MIN_WIDTH: React.CSSProperties = { minWidth: POSITION_COL + STAGES.length * STAGE_COL };

// Dev-time guard: the grid must carry exactly one track per stage (plus the leading
// position column), so the derived template can never silently decouple from
// STAGES.length the way the old hardcoded repeat(7) did.
if (process.env.NODE_ENV !== "production") {
  const stageTracks = Number(/repeat\((\d+),/.exec(String(BOARD_GRID.gridTemplateColumns))?.[1]);
  console.assert(
    stageTracks === STAGES.length,
    `[PipelineBoard] grid stage tracks (${stageTracks}) must equal STAGES.length (${STAGES.length})`
  );
}
