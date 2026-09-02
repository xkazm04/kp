"use client";

import { useMemo } from "react";
import type { useTranslations } from "next-intl";
import { ColumnStats } from "./MatrixShared";
import { Defer } from "@/app/_components/ui/Defer";
import { MatrixGridRow } from "./MatrixGridRow";
import { type Candidate, type Matrix, type Position } from "./matrixTabTypes";
import { MATRIX_HEADER_ROW } from "./matrixGridKeys";
import { EMPTY_COLUMN_STAT } from "./matrixStats";
import { useMatrixGridKeys } from "./useMatrixGridKeys";
import type { Cell } from "./matrixCellClass";
import type { ColumnStat } from "./matrixStats";

// The Fit Matrix's scrollable candidate × position grid: sortable column
// headers with a per-role distribution strip, and per-cell score/select
// buttons. Split out of MatrixTab.tsx to keep that file under the 200-line cap.
//
// Keyboard model: role="grid" + a roving tabindex (useMatrixGridKeys) — one Tab in,
// arrows/Home/End/PageUp/PageDown between the sort headers and the cells. Reaching the
// last of 200×N cells by Tab alone used to cost ~1,600 presses.
//
// Position announcement: the table declared role="grid" but nothing else, so the arrow
// keys moved focus through a rectangle the reader could not locate themselves in — no
// "row 14 of 63, column 3 of 9". The row/column indices below are 1-BASED and count the
// header row and the sticky candidate column, per the WAI-ARIA grid pattern: header row
// = aria-rowindex 1, data row r = r + 2; candidate column = aria-colindex 1, position
// column ci = ci + 2. Pinned by matrixGridRoles.test.ts — the indices only mean anything
// while aria-rowcount/aria-colcount agree with them.
//
// grid-stays-still-while-you-scroll: each candidate row is a MEMO BOUNDARY
// (`MatrixGridRow`), fed per-row signatures instead of the shared selection/added Sets
// and its own roving column instead of the whole roving cell. See that file's header for
// which props carry the comparison and which are only stable by construction.
export function MatrixGrid({
  data,
  cols,
  rows,
  colStats,
  rowStrong,
  sortCol,
  setSortCol,
  selectMode,
  selected,
  toggleCell,
  openCell,
  added,
  t,
  enumLabel,
  blockedLabel,
}: {
  data: Matrix;
  cols: { p: Position; i: number }[];
  rows: { cand: Candidate; ri: number }[];
  colStats: Record<number, ColumnStat>;
  rowStrong: Record<number, number>;
  sortCol: number | null;
  setSortCol: (updater: (cur: number | null) => number | null) => void;
  selectMode: boolean;
  selected: Set<string>;
  toggleCell: (candId: string, posId: string) => void;
  openCell: (cand: Candidate, pos: Position, cell: Cell, ev: React.MouseEvent<HTMLButtonElement>) => void;
  added: Set<string>;
  t: ReturnType<typeof useTranslations<"matrix">>;
  enumLabel: (kind: string, value: string) => string;
  blockedLabel: (c: { koKeys?: string[] }) => string;
}) {
  const { scrollerRef, cornerRef, roving, cellProps } = useMatrixGridKeys({ rows: rows.length, cols: cols.length });
  // Per-row signatures of the two Sets. Built in ONE pass over the visible rectangle
  // (the same O(rows × cols) the render already pays) so each memoized row can compare a
  // string instead of a Set identity that changes on every toggle anywhere in the grid.
  const { selSigs, addSigs } = useMemo(() => {
    const sel: string[] = [];
    const add: string[] = [];
    for (const { cand } of rows) {
      const s: string[] = [];
      const a: string[] = [];
      for (const { p } of cols) {
        const key = `${cand.id}|${p.id}`;
        if (selected.has(key)) s.push(key);
        if (added.has(key)) a.push(key);
      }
      sel.push(s.join(","));
      add.push(a.join(","));
    }
    return { selSigs: sel, addSigs: add };
  }, [rows, cols, selected, added]);
  return (
    <>
      <div ref={scrollerRef} className="overflow-auto rounded-lg border border-stone-200 bg-white shadow-panel" style={{ maxHeight: "70vh" }}>
        <table
          role="grid"
          aria-rowcount={rows.length + 1}
          aria-colcount={cols.length + 1}
          className="border-collapse text-sm"
        >
          <thead>
            <tr aria-rowindex={1}>
              <th ref={cornerRef} scope="col" role="columnheader" aria-colindex={1} className="sticky left-0 top-0 z-20 border-b border-r border-stone-200 bg-paper p-2 text-left font-semibold text-steel">
                {t("candidateHeader")}
              </th>
              {cols.map(({ p, i }, ci) => (
                <th
                  key={p.id}
                  scope="col"
                  role="columnheader"
                  aria-colindex={ci + 2}
                  className={`sticky top-0 z-10 border-b bg-paper p-1.5 align-bottom ${sortCol === i ? "border-coral" : "border-stone-100"}`}
                >
                  {/* Click a column to rank candidates by their fit for THAT role
                      (MAT6); click again to clear back to best-overall. */}
                  <button
                    {...cellProps(MATRIX_HEADER_ROW, ci, roving.row === MATRIX_HEADER_ROW && roving.col === ci)}
                    type="button"
                    onClick={() => setSortCol((cur) => (cur === i ? null : i))}
                    aria-pressed={sortCol === i}
                    title={t("colTitle", { title: p.title, seniority: enumLabel("seniority", p.seniority), action: sortCol === i ? t("colSortingClear") : t("colClickSort") })}
                    className="focus-ring block w-[84px] rounded text-left hover:text-coral"
                  >
                    <span className={`block truncate font-semibold ${sortCol === i ? "text-coral" : "text-ink"}`}>
                      {sortCol === i ? "▼ " : ""}{p.title}
                    </span>
                    <span className="block text-sm uppercase text-steel">{enumLabel("seniority", p.seniority)}</span>
                  </button>
                  <ColumnStats stat={colStats[i] ?? EMPTY_COLUMN_STAT} />
                </th>
              ))}
            </tr>
          </thead>
          {/* Tier 3: the grid body is the payload — on a large pool this is hundreds
              of cell buttons. The row/column headers above have already painted;
              defer the rows one frame so the tab's first commit for this fetch
              never has to build the whole table in one frame. */}
          <Defer strategy="next-frame">
          <tbody>
            {rows.map(({ cand, ri }, r) => (
              <MatrixGridRow
                key={cand.id}
                cand={cand}
                ri={ri}
                r={r}
                cols={cols}
                cells={data.cells}
                placements={data.placements}
                strong={rowStrong[ri] ?? 0}
                selectMode={selectMode}
                selSig={selSigs[r] ?? ""}
                addSig={addSigs[r] ?? ""}
                rovingCol={roving.row === r ? roving.col : null}
                cellProps={cellProps}
                toggleCell={toggleCell}
                openCell={openCell}
                t={t}
                enumLabel={enumLabel}
                blockedLabel={blockedLabel}
              />
            ))}
          </tbody>
          </Defer>
        </table>
      </div>
    </>
  );
}
