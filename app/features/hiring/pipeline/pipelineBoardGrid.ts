// The board's per-cell overflow cut: pipelineBoardLayout buckets entries per
// (lane, stage) cell and the +N affordances count against this. The grid geometry
// that used to live here (boardGrid / boardMinWidth) went with the card board; the
// map board owns its own column widths in map/PipelineBoardSubway.tsx.
export const CELL_LIMIT = 6;
