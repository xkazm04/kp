"use client";

import { Check } from "lucide-react";
import type { useTranslations } from "next-intl";
import { isTerminalEntryStatus } from "@/app/_lib/pipeline-status";
import { cellClass, ColumnStats } from "./MatrixShared";
import { Defer } from "@/app/_components/ui/Defer";
import { STRONG_THRESHOLD } from "./matrixStats";
import { archStyle, STAGE_INITIAL, type Candidate, type Matrix, type Position } from "./matrixTabTypes";
import { MATRIX_HEADER_ROW } from "./matrixGridKeys";
import { useMatrixGridKeys } from "./useMatrixGridKeys";
import type { Cell } from "./MatrixShared";

// The Fit Matrix's scrollable candidate × position grid: sortable column
// headers with a per-role distribution strip, and per-cell score/select
// buttons. Split out of MatrixTab.tsx to keep that file under the 200-line cap.
//
// Keyboard model: role="grid" + a roving tabindex (useMatrixGridKeys) — one Tab in,
// arrows/Home/End/PageUp/PageDown between the sort headers and the cells. Reaching the
// last of 200×N cells by Tab alone used to cost ~1,600 presses.
export function MatrixGrid({
  data,
  cols,
  rows,
  colScores,
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
  colScores: Record<number, number[]>;
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
  const { scrollerRef, cornerRef, cellProps } = useMatrixGridKeys({ rows: rows.length, cols: cols.length });
  return (
    <>
      <div ref={scrollerRef} className="overflow-auto rounded-lg border border-stone-200 bg-white shadow-panel" style={{ maxHeight: "70vh" }}>
        <table role="grid" className="border-collapse text-sm">
          <thead>
            <tr>
              <th ref={cornerRef} scope="col" className="sticky left-0 top-0 z-20 border-b border-r border-stone-200 bg-paper p-2 text-left font-semibold text-steel">
                {t("candidateHeader")}
              </th>
              {cols.map(({ p, i }, ci) => (
                <th
                  key={p.id}
                  scope="col"
                  className={`sticky top-0 z-10 border-b bg-paper p-1.5 align-bottom ${sortCol === i ? "border-coral" : "border-stone-100"}`}
                >
                  {/* Click a column to rank candidates by their fit for THAT role
                      (MAT6); click again to clear back to best-overall. */}
                  <button
                    {...cellProps(MATRIX_HEADER_ROW, ci)}
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
                  <ColumnStats scores={colScores[i] ?? []} />
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
            {rows.map(({ cand, ri }, r) => {
              const a = archStyle(cand.archetype);
              return (
                <tr key={cand.id} className="hover:bg-paper/40">
                  <th scope="row" className="sticky left-0 z-10 border-b border-r border-stone-100 bg-white p-2 text-left font-normal">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${a.bg}`} title={enumLabel("archetype", a.id)} />
                      <span className="w-[120px] truncate font-medium text-ink">{cand.label}</span>
                      {/* MAT2 row counterpart: strong-fit count across visible roles. */}
                      {rowStrong[ri] > 0 ? (
                        <span
                          className="ml-auto shrink-0 rounded-full bg-moss/10 px-1.5 text-meta font-semibold text-moss nums"
                          title={t("strongFitTitle", { threshold: STRONG_THRESHOLD, count: rowStrong[ri], total: cols.length })}
                        >
                          {`${rowStrong[ri]}★`}
                        </span>
                      ) : null}
                    </div>
                  </th>
                  {cols.map(({ p, i }, ci) => {
                    const c = data.cells[ri]?.[i] ?? { score: null, blocked: true };
                    const place = data.placements[`${cand.id}|${p.id}`];
                    // "In the pipeline" = placed and not in a terminal state.
                    // Must exclude `declined` as well as `rejected`, else a
                    // candidate who turned us down still rings as in-flight.
                    const inPipe = place && !isTerminalEntryStatus(place.status);
                    const key = `${cand.id}|${p.id}`;
                    const wasAdded = added.has(key);
                    const ringed = inPipe || wasAdded;
                    // Selectable only when there's something to add: a scored
                    // (non-blocked) cell that isn't already in the pipeline / just added.
                    const selectable = selectMode && !c.blocked && !ringed;
                    const isSel = selected.has(key);
                    return (
                      <td key={p.id} className="border-b border-l border-stone-50 p-0">
                        {/* `aria-disabled`, never `disabled`: a disabled cell drops out of
                            the tab order and takes its accessible name — the reason it
                            cannot be selected — with it. The click handler is already
                            inert (`selectable &&`), so the cell stays reachable and silent.
                            `focus-visible:z-[5]`: every cell is `relative`, so a later
                            sibling would paint over the coral ring's outer 4px — lift the
                            focused one above its neighbours, still under the sticky
                            headers (z-10/20). */}
                        <button
                          {...cellProps(r, ci)}
                          type="button"
                          onClick={(ev) => (selectMode ? selectable && toggleCell(cand.id, p.id) : openCell(cand, p, c, ev))}
                          aria-disabled={selectMode && !selectable ? true : undefined}
                          title={
                            selectMode
                              ? selectable
                                ? t("cellSelectTitle", { action: isSel ? t("deselect") : t("select"), cand: cand.label, pos: p.title })
                                : t("cellBlockedTitle", { cand: cand.label, pos: p.title, reason: c.blocked ? blockedLabel(c) : ringed ? t("alreadyInPipe") : "" })
                              : t("cellTitle", { cand: cand.label, pos: p.title, val: c.blocked ? blockedLabel(c) : c.score ?? 0, place: place ? t("inPipelineStage", { stage: enumLabel("stage", place.stage) }) : "" })
                          }
                          aria-label={t("cellAria", {
                            cand: cand.label,
                            pos: p.title,
                            val: c.blocked ? blockedLabel(c) : t("matchVal", { score: c.score ?? 0 }),
                            ring: ringed ? t("inPipelineSuffix") : "",
                            sel: selectMode && selectable ? (isSel ? t("selectedSuffix") : t("selectableSuffix")) : "",
                          })}
                          aria-pressed={selectMode ? isSel : undefined}
                          className={`relative grid h-9 w-full place-items-center font-semibold transition-transform focus-visible:z-[5] ${
                            selectMode
                              ? selectable
                                ? "cursor-pointer"
                                : "cursor-default opacity-50"
                              : // Spark Dark: a browsed cell pops like a peeled sticker
                                // (tilt + hard shadow over its neighbors) instead of the
                                // light register's flat zoom.
                                "hover:scale-105 dark:hover:z-10 dark:hover:-rotate-2 dark:hover:scale-110 dark:hover:shadow-sticker-xs"
                          } ${cellClass(c)} ${
                            isSel ? "ring-2 ring-inset ring-coral" : ringed ? "ring-2 ring-inset ring-ink/50" : ""
                          }`}
                        >
                          {c.blocked ? "–" : c.score}
                          {isSel ? (
                            <span className="absolute right-0.5 top-0.5"><Check size={11} className="text-coral" /></span>
                          ) : ringed ? (
                            <span className="absolute right-0.5 top-0.5 text-sm font-bold text-ink/70">
                              {wasAdded && !inPipe ? "+" : STAGE_INITIAL[place?.stage ?? ""] ?? ""}
                            </span>
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          </Defer>
        </table>
      </div>
    </>
  );
}
