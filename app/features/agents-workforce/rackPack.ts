// Packing the lifecycle racks into rows (pure; pinned by rackPack.test.ts). Ported from the contest winner's
// `pack` (agents-workforce-r2 C/3 rack.js): each rack asks for as many card columns as it has cards (at most
// what one row can hold), and a row takes the next rack whenever the sum of its needs still fits the width.

export const CARD_GAP = 12;
export const RACK_PAD = 10;
export const RACK_GAP = 14;

/** The card's minimum width at a given wall width: 214px up to 262px, a ninth of the wall between. */
export function cardMin(wallWidth: number): number {
  return Math.round(Math.max(214, Math.min(262, wallWidth / 9)));
}

export type RackAsk = { n: number; span: number };

function rowNeed(row: readonly { span: number }[], cardW: number): number {
  const s = row.reduce((t, r) => t + r.span, 0);
  return s * cardW + (s - row.length) * CARD_GAP + row.length * 2 * (RACK_PAD + 2) + (row.length - 1) * RACK_GAP;
}

/** Rows of racks that fit `width`, each rack's `span` (card columns) set in place. */
export function packRacks<T extends RackAsk>(racks: T[], width: number, cardW: number): T[][] {
  const rows: T[][] = [];
  let cur: T[] = [];
  const maxAlone = Math.max(1, Math.floor((width - 2 * (RACK_PAD + 2) + CARD_GAP) / (cardW + CARD_GAP)));
  for (const r of racks) {
    const want = Math.min(Math.max(1, r.n), maxAlone);
    const min = Math.min(want, r.n > 1 ? 2 : 1);
    let placed = false;
    if (cur.length) {
      for (let sp = want; sp >= min; sp--) {
        if (rowNeed([...cur, { span: sp }], cardW) <= width) {
          r.span = sp;
          cur.push(r);
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      if (cur.length) rows.push(cur);
      r.span = want;
      cur = [r];
    }
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/** A row's grid template: each rack's columns weighted by what it needs. */
export function rowColumns(row: readonly { span: number }[], cardW: number): string {
  return row.map((r) => `minmax(0, ${r.span * cardW + (r.span - 1) * CARD_GAP + 2 * RACK_PAD}fr)`).join(" ");
}
