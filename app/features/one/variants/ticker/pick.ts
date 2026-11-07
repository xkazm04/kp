// Which view Ticker draws where. Pure, so node:test reads it directly.
//
// The answer is ONE full-width table: the view in front when it is not pinned, else the
// newest unpinned view (ids are the host's `p<seq>`, so the highest seq is the newest).
// The other unpinned views stay reachable as sheet tabs over the table; pinned views live
// on the side rail.
import type { PanelInstance } from "../../types";

const seqOf = (id: string) => {
  const n = Number(id.replace(/^\D+/, ""));
  return Number.isFinite(n) ? n : -1;
};

export type TickerPick = {
  /** The view the table draws; null when nothing unpinned is on screen. */
  main: PanelInstance | null;
  /** Every unpinned view, in the region's reading order (the sheet tabs). */
  sheets: PanelInstance[];
  /** Pinned views, in the region's reading order (the side rail). */
  pins: PanelInstance[];
};

export function pick(panels: readonly PanelInstance[], focusId: string | null): TickerPick {
  const sheets = panels.filter((p) => !p.pinned);
  const pins = panels.filter((p) => p.pinned);
  const focused = sheets.find((p) => p.id === focusId) ?? null;
  const newest = sheets.reduce<PanelInstance | null>((best, p) => (best && seqOf(best.id) >= seqOf(p.id) ? best : p), null);
  return { main: focused ?? newest, sheets, pins };
}

/** The steps from the answer in view to answer `target` (negative = back). */
export function stepsTo(cursor: number, target: number): number {
  return target - cursor;
}
