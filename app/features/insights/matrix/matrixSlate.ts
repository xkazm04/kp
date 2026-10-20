// Per-role slate PROPOSAL over the visible grid (greedy by score, one role per
// candidate). Never writes: picks load into the select-mode selection for Add.
import { FIT_PROMISING_FLOOR } from "@/app/_lib/fit-thresholds";
import { isTerminalEntryStatus } from "@/app/_lib/pipeline-status";
import type { Cell } from "./matrixCellClass";
import { matrixCellKey } from "./matrixSelection";

export type SlateState = "clear" | "contested" | "thin" | "uncovered";
type Pick = { candId: string; label: string; score: number };
export type SlateLine = {
  posId: string;
  title: string;
  pick: Pick | null;
  state: SlateState;
  rival: (Pick & { placedOn: string }) | null; // top eligible scorer, allocated elsewhere
  separated: boolean | null; // pick's confidence.low > runner-up's confidence.high; null when either band is absent
};
export type Slate = { lines: SlateLine[]; filled: number; total: number };

export function proposeSlate({ rows, cols, cells, placements, added, locale }: {
  rows: readonly { cand: { id: string; label: string }; ri: number }[];
  cols: readonly { p: { id: string; title: string }; i: number }[];
  cells: readonly (readonly Cell[])[];
  placements: Readonly<Record<string, { status: string }>>;
  added?: ReadonlySet<string>;
  locale: string;
}): Slate {
  const collate = new Intl.Collator(locale).compare;
  type Pair = Pick & { col: number; cell: Cell };
  const assessed: Pair[][] = cols.map(() => []);
  const eligible: Pair[] = [];
  cols.forEach(({ p, i }, col) => {
    for (const { cand, ri } of rows) {
      const cell = cells[ri]?.[i];
      if (!cell || cell.blocked || cell.score == null) continue;
      const pair = { candId: cand.id, label: cand.label, score: cell.score, col, cell };
      assessed[col].push(pair);
      const key = matrixCellKey(cand.id, p.id);
      const place = placements[key];
      if ((place && !isTerminalEntryStatus(place.status)) || added?.has(key)) continue;
      if (cell.score >= FIT_PROMISING_FLOOR) eligible.push(pair);
    }
  });
  const order = (a: Pair, b: Pair) =>
    b.score - a.score || collate(a.label, b.label) || (a.candId < b.candId ? -1 : a.candId > b.candId ? 1 : 0) || a.col - b.col;
  eligible.sort(order);
  const pickOf = new Map<number, Pair>();
  const roleOf = new Map<string, number>();
  for (const e of eligible) {
    if (pickOf.has(e.col) || roleOf.has(e.candId)) continue;
    pickOf.set(e.col, e);
    roleOf.set(e.candId, e.col);
  }
  const lines = cols.map(({ p }, col): SlateLine => {
    const got = pickOf.get(col);
    const top = eligible.find((e) => e.col === col);
    const away = top && top.candId !== got?.candId ? roleOf.get(top.candId) : undefined;
    const rival = top && away != null ? { candId: top.candId, label: top.label, score: top.score, placedOn: cols[away].p.title } : null;
    const next = got && assessed[col].filter((a) => a.candId !== got.candId).sort(order)[0];
    // Separation is band against band: the pick's floor must clear the runner-up's
    // CEILING. Against the runner-up's point score, a runner-up whose own band reaches
    // past the pick's floor read as "separated" (80 [76-84] vs 75 [71-79] is a 1-point
    // overlap). Touching is not separated; either band missing is unknown (null).
    const band = got?.cell.confidence;
    const nextBand = next ? next.cell.confidence : undefined;
    return {
      posId: p.id,
      title: p.title,
      pick: got ? { candId: got.candId, label: got.label, score: got.score } : null,
      state: !got ? (rival ? "contested" : "uncovered") : assessed[col].length < 2 ? "thin" : rival ? "contested" : "clear",
      rival,
      separated: band && nextBand ? band.low > nextBand.high : null,
    };
  });
  return { lines, filled: pickOf.size, total: cols.length };
}

/** A NEW selection of exactly the picks' keys; `prev` is replaced, never mutated. */
export function applySlateToSelection(_prev: ReadonlySet<string>, slate: Slate): Set<string> {
  return new Set(slate.lines.flatMap((l) => (l.pick ? [matrixCellKey(l.pick.candId, l.posId)] : [])));
}
