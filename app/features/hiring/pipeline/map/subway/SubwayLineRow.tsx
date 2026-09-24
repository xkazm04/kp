"use client";

// One position = one metro line: the sticky line header (badge, title, head-count,
// rank action), a 2px track across the stage columns, and per station a cell whose
// underlay button opens the orchard while its beads open the candidate detail.

import { useState } from "react";
import { ListOrdered } from "lucide-react";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry, Position } from "@/app/features/shared/pipelineTypes";
import type { CellSelection, LineAction } from "../mapTypes";
import type { LineAttention as LineCounts } from "./lineAttention";
import { LineContextMenu } from "./LineContextMenu";
import { Bead, BeadOverflow } from "./SubwayBeads";
import { LineAttention, RejectedMark, Station } from "./SubwayMarks";
import { BEAD_LIMIT, LINE_COL } from "./subwayGeometry";

export type LineLabels = { active: string; openJd: string; rank: string; waiting: string; rejected: string };

export function LineRow({
  position,
  axis,
  cells,
  attention,
  gridStyle,
  openCell,
  terminal,
  cellAria,
  cellEmpty,
  stageLabel,
  labels,
  beadTitle,
  beadLabel,
  onOpenCell,
  openJob,
  openPositionRanking,
  openCandidate,
  rejectedCount,
  onOpenRejected,
  onLineAction,
  bouncedEntryId,
  bouncedReason,
}: {
  position: Position;
  axis: readonly StageDef[];
  cells: Entry[][];
  /** Who this line's candidates are waiting on — a person, the AI. */
  attention: LineCounts;
  rejectedCount: number;
  onOpenRejected: (origin: CellSelection["origin"]) => void;
  /** Absent = no context menu (the board's consumer did not wire batch actions). */
  onLineAction?: (action: LineAction) => void;
  bouncedEntryId?: string | null;
  bouncedReason?: string | null;
  gridStyle: React.CSSProperties;
  openCell: { positionId: string; stageId: string } | null;
  terminal: boolean;
  cellAria: (stage: string, count: number) => string;
  cellEmpty: string;
  stageLabel: (stage: StageDef) => string;
  labels: LineLabels;
  beadTitle: (e: Entry) => string;
  beadLabel: (e: Entry) => string;
  onOpenCell: (sel: CellSelection) => void;
  openJob: (jobId: string) => void;
  openPositionRanking: (jobId: string) => void;
  openCandidate: (entry: Entry, cohort: readonly Entry[]) => void;
}) {
  // The row menu acts on the ENTRY column's active candidates (lineActions.ts).
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const entryAt = axis.findIndex((s) => s.role === "entry");
  const entryCount = entryAt >= 0 ? (cells[entryAt] ?? []).filter((e) => e.status === "active").length : 0;
  return (
    <div className="relative grid border-b border-stone-200 last:border-0" style={gridStyle} role="row">
      {menuAt && onLineAction ? (
        <LineContextMenu at={menuAt} count={entryCount} onPick={onLineAction} onClose={() => setMenuAt(null)} />
      ) : null}
      {/* The track itself — one 2px rule running the width of the stage columns. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-stone-200 dark:bg-stone-300"
        style={{ left: LINE_COL, right: 0 }}
      />
      {terminal ? (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-1.5 -translate-y-1/2 rounded-full bg-moss"
        />
      ) : null}
      <div
        role="rowheader"
        aria-haspopup={onLineAction ? "menu" : undefined}
        onContextMenu={
          onLineAction
            ? (ev) => {
                ev.preventDefault();
                setMenuAt({ x: ev.clientX, y: ev.clientY });
              }
            : undefined
        }
        className="sticky left-0 z-10 flex h-10 items-center gap-2 border-r border-stone-200 bg-white px-3"
      >
        <LineAttention counts={attention} label={labels.waiting} />
        <button
          type="button"
          onClick={() => openJob(position.id)}
          title={labels.openJd}
          className="focus-ring cursor-pointer truncate text-left text-sm font-semibold leading-tight text-ink hover:text-coral"
        >
          {position.title}
        </button>
        <span className="ml-auto shrink-0 text-sm text-steel nums" title={labels.active} aria-label={labels.active}>
          {position.count}
        </span>
        <RejectedMark
          count={rejectedCount}
          label={labels.rejected}
          onOpen={(r) => onOpenRejected({ x: r.x, y: r.y, width: r.width, height: r.height })}
        />
        <button
          type="button"
          onClick={() => openPositionRanking(position.id)}
          title={labels.rank}
          aria-label={labels.rank}
          className="focus-ring shrink-0 cursor-pointer rounded p-0.5 text-steel hover:text-coral"
        >
          <ListOrdered aria-hidden className="h-4 w-4" />
        </button>
      </div>
      {axis.map((stage, i) => {
        const cellEntries = cells[i] ?? [];
        const empty = cellEntries.length === 0;
        const overflow = cellEntries.length > BEAD_LIMIT;
        const isOpen = openCell?.positionId === position.id && openCell.stageId === stage.id;
        return (
          <div
            key={stage.id}
            role="gridcell"
            // An EMPTY station is inert: no button, no hover, nothing to expand. It
            // still says so in words — the cell itself carries the name and the hint
            // the (absent) station button would have.
            aria-label={empty ? cellAria(stageLabel(stage), 0) : undefined}
            title={cellEntries.length === 0 ? cellEmpty : undefined}
            className={`relative flex h-10 items-center gap-2 border-r border-stone-200 px-3 last:border-0 ${
              empty ? "" : isOpen ? "group bg-coral/10 ring-1 ring-inset ring-coral" : "group hover:bg-stone-100"
            }`}
          >
            {/* The station button fills the cell UNDER the beads (absolute, z-0), so a
                click on a bead is the bead's and a click anywhere else is the cell's.
                Beads are siblings, never children: a button inside a button is not
                markup, and a screen reader would lose one of the two. */}
            {empty ? null : (
              <button
                type="button"
                aria-label={cellAria(stageLabel(stage), cellEntries.length)}
                aria-haspopup="dialog"
                onClick={(ev) => {
                  const r = ev.currentTarget.getBoundingClientRect();
                  onOpenCell({
                    position,
                    stage,
                    stageIndex: i,
                    entries: cellEntries,
                    origin: { x: r.x, y: r.y, width: r.width, height: r.height },
                  });
                }}
                className="focus-ring absolute inset-0 z-0 cursor-pointer"
              />
            )}
            <Station occupied={cellEntries.length > 0} />
            <span className="relative flex items-center -space-x-1">
              {cellEntries.slice(0, BEAD_LIMIT).map((e) => (
                <Bead
                  key={e.id}
                  entry={e}
                  title={beadTitle(e)}
                  label={beadLabel(e)}
                  onOpen={() => openCandidate(e, cellEntries)}
                  bouncedReason={e.id === bouncedEntryId ? bouncedReason : null}
                />
              ))}
              {overflow ? (
                <BeadOverflow
                  hidden={cellEntries.slice(BEAD_LIMIT)}
                  title={(e) => e.id === bouncedEntryId && bouncedReason ? `${beadTitle(e)} — ${bouncedReason}` : beadTitle(e)}
                  label={(e) => e.id === bouncedEntryId && bouncedReason ? `${beadLabel(e)}. ${bouncedReason}` : beadLabel(e)}
                  onOpen={(e) => openCandidate(e, cellEntries)}
                />
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
