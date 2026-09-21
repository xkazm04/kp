// Geometry of the Subway board.

/** The sticky leading "line name" column: indicators, title, head-count, rank action. */
export const LINE_COL = 280; // px
/** Min width of one station column — it only has to hold five overlapping beads
 *  and a "+N", not a card. */
export const STATION_COL = 200; // px
/** Beads shown before the run collapses into a "+N" bead. */
export const BEAD_LIMIT = 5;
