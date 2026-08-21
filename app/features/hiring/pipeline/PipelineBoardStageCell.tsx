"use client";

// One stage cell of the pipeline board. Split out of PipelineBoard.tsx.
//
// The overflow control is a real focusable button (was a title-only <p>) so
// keyboard/touch users can reveal the hidden candidates, which then render as
// the same navigable CandidateRows.
//
// Memoized (stageCellEqual): a poll that changes ONE card in ONE cell must not
// reconcile every other cell. The cell re-renders only when its own signature —
// each entry's rendered content plus its stale verdict and selected state — or one
// of its mode flags changes; the callback props (fresh per parent render) are
// excluded, matching CandidateRow's memoization.

import { memo, useState } from "react";
import { useTranslations } from "next-intl";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { CandidateRow } from "./PipelineShared";
import { stageCellSignature } from "./pipelineRenderDiet";
import { CELL_LIMIT } from "./pipelineBoardGrid";
import { DEFAULT_BOARD_AXIS, type Entry, type StageDef } from "@/app/features/shared/pipelineTypes";

function StageCellImpl({
  stage,
  entries,
  isStale,
  openProfile,
  openActions,
  selectMode,
  selectedIds,
  onToggleSelect,
  dragEnabled,
  isDragging,
  onDragStartEntry,
  onDragEndEntry,
  onDropToStage,
  onMoveEntry,
  axis = DEFAULT_BOARD_AXIS,
}: {
  stage: string;
  entries: Entry[];
  isStale: (e: Entry) => boolean;
  openProfile: (e: Entry) => void;
  openActions: (e: Entry) => void;
  selectMode: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (e: Entry) => void;
  // cea12908 — drag-and-drop: this cell is a drop target for a candidate dragged
  // from another stage column. dragEnabled is off in select mode.
  dragEnabled: boolean;
  isDragging: boolean;
  onDragStartEntry: (e: Entry) => void;
  onDragEndEntry: () => void;
  onDropToStage: (stage: string) => void;
  // bug-ui pipeline #1 — the keyboard twin of the drop: a card's "Move to…" menu
  // calls this with (entry, targetStage), funnelling into the SAME move+announce
  // path the drop uses.
  onMoveEntry: (e: Entry, toStage: string) => void;
  /** The board's resolved axis, handed straight to each row so its "Move to…" menu
   *  offers THIS workspace's columns (and their labels) rather than the shipped
   *  default. Pass-through only — the cell itself reads nothing off it. */
  axis?: readonly StageDef[];
}) {
  const t = useTranslations("pipeline");
  const [expanded, setExpanded] = useState(false);
  // Reset the "+N more" expansion when THIS cell's population actually changes —
  // WITHOUT remounting. The cell used to fold its entry ids into its React key, so
  // every 30s poll that touched any card remounted the cell, collapsing an expanded
  // overflow mid-read and churning the DOM. The key is now stage-only (stable), and
  // the expansion resets via React's official "adjust state during render on a prop
  // change" pattern: compare a stable id signature to the previous render's. An
  // unrelated lane/cell update leaves an expanded overflow intact; a real change to
  // THIS cell's card set collapses it (the user would otherwise be reading a set
  // they never expanded, with the collapse toggle silently shifted underneath).
  const idSignature = entries.map((e) => e.id).join(",");
  const [prevSignature, setPrevSignature] = useState(idSignature);
  if (idSignature !== prevSignature) {
    setPrevSignature(idSignature);
    if (expanded) setExpanded(false);
  }
  // Highlight the column the candidate would land in while a drag hovers it.
  const [dropActive, setDropActive] = useState(false);
  const overflow = entries.length - CELL_LIMIT;
  const visible = expanded ? entries : entries.slice(0, CELL_LIMIT);
  // A drop zone must preventDefault on dragover or the browser rejects the drop.
  const dropProps = dragEnabled
    ? {
        onDragOver: (ev: React.DragEvent) => {
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "move" as const;
          if (!dropActive) setDropActive(true);
        },
        onDragLeave: (ev: React.DragEvent) => {
          // Ignore leaves into child nodes — only clear when truly leaving the cell.
          if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDropActive(false);
        },
        onDrop: (ev: React.DragEvent) => {
          ev.preventDefault();
          setDropActive(false);
          onDropToStage(stage);
        },
      }
    : {};
  return (
    <div
      {...dropProps}
      className={`space-y-0.5 border-r border-stone-200 px-1.5 py-2 last:border-0 ${
        isDragging ? "transition-colors" : ""
      } ${dropActive ? "bg-coral/5 ring-1 ring-inset ring-coral/40" : ""}`}
    >
      {visible.map((e) => (
        <CandidateRow
          key={e.id}
          entry={e}
          pending={needsHumanDecision(e.approvalKind)}
          stale={isStale(e)}
          onOpen={() => openProfile(e)}
          onActions={() => openActions(e)}
          selectMode={selectMode}
          selected={selectedIds.has(e.id)}
          onToggleSelect={() => onToggleSelect(e)}
          draggable={dragEnabled}
          onDragStart={() => onDragStartEntry(e)}
          onDragEnd={onDragEndEntry}
          onMove={dragEnabled ? (toStage) => onMoveEntry(e, toStage) : undefined}
          axis={axis}
        />
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="focus-ring w-full rounded px-1 text-left text-sm font-semibold text-steel hover:text-coral"
        >
          {expanded ? t("board.showFewer") : t("board.moreCount", { count: overflow })}
        </button>
      ) : null}
      {entries.length === 0 ? <span className="px-1 text-sm text-stone-300">·</span> : null}
    </div>
  );
}

type StageCellProps = Parameters<typeof StageCellImpl>[0];

// Re-render a cell only on a change it actually shows. isStale/selectedIds are
// evaluated INTO the signature (not compared by identity), so an SLA override or a
// selection toggle re-renders the affected cell even though its entry data is
// unchanged; the handler props are deliberately not compared.
function stageCellEqual(prev: StageCellProps, next: StageCellProps): boolean {
  return (
    prev.stage === next.stage &&
    prev.selectMode === next.selectMode &&
    prev.dragEnabled === next.dragEnabled &&
    prev.isDragging === next.isDragging &&
    // The axis decides each row's move-menu contents, so a real axis edit must reach
    // them. Identity is enough: usePipelineBoardData only swaps the object when a
    // Settings save actually changed it, so the 30s poll still short-circuits here.
    prev.axis === next.axis &&
    stageCellSignature(prev.entries, prev.isStale, prev.selectedIds) ===
      stageCellSignature(next.entries, next.isStale, next.selectedIds)
  );
}

export const StageCell = memo(StageCellImpl, stageCellEqual);
