// The Background-tasks load meter: how many bars, in how many rows, light up for
// a given running-task count. Pure so the (fiddly) spill-and-cap rules are unit
// tested instead of eyeballed in the sidebar.
//
// The shape: one row of 5 bars at rest (all empty). Each running task fills one
// bar. Past 5 the meter grows a SECOND row of 5 — so 10 bars is the whole scale.
// Past 10 nothing more happens: a saturated meter is the signal ("more than the
// bar can show"), and the exact number stays available as the numeric badge.

/** Bars in one row — the meter's granularity. */
export const METER_BARS_PER_ROW = 5;
/** Hard ceiling: two full rows. Beyond this the meter simply reads as full. */
export const METER_MAX_BARS = METER_BARS_PER_ROW * 2;

/** Filled-bar count for each row to render (length 1 or 2). Every row draws
 *  METER_BARS_PER_ROW bars; the remainder are the empty/neutral ones. The second
 *  row exists only once the count spills past the first — an idle sidebar shows
 *  one quiet row, not a double-height gauge. */
export function taskMeterRows(running: number): number[] {
  // Defensive: a non-finite/negative count reads as idle rather than crashing or
  // rendering a NaN-length row.
  const count = Number.isFinite(running) ? Math.max(0, Math.trunc(running)) : 0;
  const filled = Math.min(count, METER_MAX_BARS);
  const rows = [Math.min(filled, METER_BARS_PER_ROW)];
  if (filled > METER_BARS_PER_ROW) rows.push(filled - METER_BARS_PER_ROW);
  return rows;
}
