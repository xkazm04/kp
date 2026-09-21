"use client";

import { memo } from "react";
import { Check } from "lucide-react";
import type { useTranslations } from "next-intl";
import { isTerminalEntryStatus } from "@/app/_lib/pipeline-status";
import { announcedCellScore, cellClass } from "./matrixCellClass";
import type { Cell } from "./matrixCellClass";
import { STRONG_THRESHOLD } from "./matrixStats";
import { archStyle, STAGE_INITIAL, type Candidate, type Position } from "./matrixTabTypes";

// grid-stays-still-while-you-scroll. One candidate row of the Fit Matrix, extracted from
// MatrixGrid.tsx so it can be a MEMO BOUNDARY.
//
// The grid is up to 200 rows × N roles, and every cell builds two full sentences through
// the translator (`title` and `aria-label`). Nothing memoized any of it, so every render
// of the tab rebuilt all of them — for a popover reposition, for a filter change that
// moved no row, for a single cell being selected.
//
// What the memo compares, and why each prop is shaped the way it is:
//
//   • `cells`, `placements`, `cols`, `cand` are references OUT of `data` / a `useMemo`,
//     so they are stable while the underlying data is.
//   • `selSig` / `addSig` are per-row SIGNATURES, not the shared `Set`s. A Set is a new
//     object on every toggle, so passing it would re-render all 200 rows when one cell
//     changed; the signature only changes for the row that actually gained or lost a
//     selection.
//   • `rovingCol` is this row's own roving column (`null` when the tab stop is elsewhere),
//     for the same reason: arrowing between cells must re-render two rows, not all of them.
//   • `t`, `enumLabel`, `blockedLabel`, `toggleCell`, `openCell` and `cellProps` are all
//     stable identities by construction (next-intl memoizes its translator; the rest are
//     `useCallback`s in useMatrixTab / useMatrixGridKeys). If one of them ever stops being
//     stable this memo silently becomes a no-op — which is why they are named here.
export type MatrixGridRowProps = {
  cand: Candidate;
  /** Index into `cells` / `placements` — the row's position in the UNFILTERED data. */
  ri: number;
  /** Index in the RENDERED order: the roving-rectangle row and `aria-rowindex` base. */
  r: number;
  cols: { p: Position; i: number }[];
  cells: Cell[][];
  placements: Record<string, { stage: string; status: string }>;
  strong: number;
  selectMode: boolean;
  selSig: string;
  addSig: string;
  rovingCol: number | null;
  cellProps: (row: number, col: number, tabStop: boolean) => Record<string, unknown>;
  toggleCell: (candId: string, posId: string) => void;
  openCell: (cand: Candidate, pos: Position, cell: Cell, ev: React.MouseEvent<HTMLButtonElement>) => void;
  t: ReturnType<typeof useTranslations<"matrix">>;
  enumLabel: (kind: string, value: string) => string;
  blockedLabel: (c: { koKeys?: string[] }) => string;
};

function MatrixGridRowInner({
  cand,
  ri,
  r,
  cols,
  cells,
  placements,
  strong,
  selectMode,
  selSig,
  addSig,
  rovingCol,
  cellProps,
  toggleCell,
  openCell,
  t,
  enumLabel,
  blockedLabel,
}: MatrixGridRowProps) {
  const a = archStyle(cand.archetype);
  // The signatures are the memo's currency; membership is read back out of them here so
  // the row never needs the shared Sets at all.
  const selectedKeys = selSig ? new Set(selSig.split(",")) : null;
  const addedKeys = addSig ? new Set(addSig.split(",")) : null;
  return (
    <tr aria-rowindex={r + 2} className="hover:bg-paper/40">
      <th scope="row" role="rowheader" aria-colindex={1} className="sticky left-0 z-10 border-b border-r border-stone-100 bg-white p-2 text-left font-normal">
        <div className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${a.bg}`} title={enumLabel("archetype", a.id)} />
          <span className="w-[120px] truncate font-medium text-ink">{cand.label}</span>
          {/* MAT2 row counterpart: strong-fit count across visible roles. */}
          {strong > 0 ? (
            <span
              className="ml-auto shrink-0 rounded-full bg-moss/10 px-1.5 text-meta font-semibold text-moss nums"
              title={t("strongFitTitle", { threshold: STRONG_THRESHOLD, count: strong, total: cols.length })}
            >
              {`${strong}★`}
            </span>
          ) : null}
        </div>
      </th>
      {cols.map(({ p, i }, ci) => {
        const c = cells[ri]?.[i] ?? { score: null, blocked: true };
        const place = placements[`${cand.id}|${p.id}`];
        // "In the pipeline" = placed and not in a terminal state. Must exclude
        // `declined` as well as `rejected`, else a candidate who turned us down
        // still rings as in-flight.
        const inPipe = place && !isTerminalEntryStatus(place.status);
        const key = `${cand.id}|${p.id}`;
        const wasAdded = addedKeys?.has(key) ?? false;
        const ringed = inPipe || wasAdded;
        // Selectable only when there's something to add: a scored (non-blocked) cell
        // that isn't already in the pipeline / just added.
        const selectable = selectMode && !c.blocked && !ringed;
        const isSel = selectedKeys?.has(key) ?? false;
        // The one predicate the colour, the cell body and the accessible name share.
        const announced = announcedCellScore(c);
        return (
          <td key={p.id} role="gridcell" aria-colindex={ci + 2} className="border-b border-l border-stone-50 p-0">
            {/* `aria-disabled`, never `disabled`: a disabled cell drops out of
                the tab order and takes its accessible name — the reason it
                cannot be selected — with it. The click handler is already
                inert (`selectable &&`), so the cell stays reachable and silent.
                `focus-visible:z-[5]`: every cell is `relative`, so a later
                sibling would paint over the coral ring's outer 4px — lift the
                focused one above its neighbours, still under the sticky
                headers (z-10/20). */}
            <button
              {...cellProps(r, ci, rovingCol === ci)}
              type="button"
              onClick={(ev) => (selectMode ? selectable && toggleCell(cand.id, p.id) : openCell(cand, p, c, ev))}
              aria-disabled={selectMode && !selectable ? true : undefined}
              title={
                selectMode
                  ? selectable
                    ? t("cellSelectTitle", { action: isSel ? t("deselect") : t("select"), cand: cand.label, pos: p.title })
                    : t("cellBlockedTitle", { cand: cand.label, pos: p.title, reason: c.blocked ? blockedLabel(c) : ringed ? t("alreadyInPipe") : "" })
                  : t("cellTitle", { cand: cand.label, pos: p.title, val: c.blocked ? blockedLabel(c) : announced ?? t("cellUnassessed"), place: place ? t("inPipelineStage", { stage: enumLabel("stage", place.stage) }) : "" })
              }
              aria-label={t("cellAria", {
                cand: cand.label,
                pos: p.title,
                // `?? 0` here announced a concrete "match 0" for a cell the grid paints
                // and renders as NOT ASSESSED. The paint's own predicate decides both now.
                val: c.blocked ? blockedLabel(c) : announced == null ? t("cellUnassessed") : t("matchVal", { score: announced }),
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
              } ${cellClass(c)} ${isSel ? "ring-2 ring-inset ring-coral" : ringed ? "ring-2 ring-inset ring-ink/50" : ""}`}
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
}

export const MatrixGridRow = memo(MatrixGridRowInner);
