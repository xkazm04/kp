/*
 * Pure layout math for step 04 (ScreenArt.tsx), ported from the prototype's
 * about-art/s4-screen.js. Every value is computed with the prototype's own
 * expressions, so the numbers in the markup are unchanged.
 */
import { r } from "./intake-geom";

/** The sheet: 15 lines of "text" (bars), widths in %. */
const WID = [96, 88, 100, 76, 98, 90, 60, 99, 84, 100, 70, 96, 82, 98, 58];
/** Rows 1, 4 and 7 are the evidence the score is traced to (row -> evidence index). */
const EVID: Record<number, number> = { 1: 0, 4: 1, 7: 2 };
const EVID_ROWS = [1, 4, 7];
/** Seconds; the scan bar is linear so each line can be timed to it. */
const SCAN_START = 0.85;
const SCAN_DUR = 1.7;

/** Glass-space anchors (u) shared by the threads svg and the css. */
const SHEET = { x: 6.2, y: 1.7, w: 13.4, h: 21.4, pad: 1.0, head: 2.6, step: 1.12, lh: 0.5 };
const PORT_Y = [5.55, 10.75, 15.95];

function rowY(k: number): number {
  return SHEET.y + SHEET.pad + SHEET.head + 1.0 + k * SHEET.step + SHEET.lh / 2;
}

export type SheetLine = { cls: string; w: string; d: string };

/** One entry per bar of the sheet: its class ("" or "ev evN"), --w and --d. */
export function sheetLines(): SheetLine[] {
  return WID.map((w, i) => {
    const y = SHEET.pad + SHEET.head + 1.0 + i * SHEET.step + SHEET.lh / 2;
    const d = SCAN_START + SCAN_DUR * (y / SHEET.h);
    return { cls: i in EVID ? "ev ev" + (EVID[i] + 1) : "", w: WID[i] + "%", d: r(d) + "s" };
  });
}

export type Thread = { d: string; x0: number; y0: number; x1: number; y1: number };

/** Three thin traces from the evidence lines to the chip ports (desktop). */
export function threads(): Thread[] {
  const x0 = SHEET.x + SHEET.w - 1.55;
  const x1 = 24.5;
  return EVID_ROWS.map((row, i) => {
    const y0 = r(rowY(row));
    const y1 = PORT_Y[i];
    const d =
      "M" + r(x0) + " " + y0 + "C" + r(x0 + 3.2) + " " + y0 + " " + r(x1 - 3.2) + " " + y1 + " " + x1 + " " + y1;
    return { d, x0: r(x0), y0, x1, y1 };
  });
}
