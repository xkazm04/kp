"use client";

// Layer 1 of the pipeline map — "Subway": the board read as a transit map.
//
// Every position is a metro LINE: one slim ~40px row with a 2px track running
// left→right across the stage columns, a station circle per stage, and the
// candidates standing there drawn as overlapping 22px beads (initials only). A role
// costs one row, so a whole portfolio is legible at once. A BEAD opens the
// candidate detail modal (openCandidate — named "Actions for {name}", the name the
// old row menu answered to); the STATION / cell opens the layer-2 overlay
// (onOpenCell). Two indicators before each line's title count the candidates waiting
// on a PERSON and on the AI, read from the hiring plan (subway/lineAttention.ts), so
// scanning down the map answers "where am I needed?".
//
// Parts: subway/useSubwayModel (derivation) · SubwayMarks (header, station, badge)
// · SubwayLineRow · SubwayBeads.
//
// A working board, in the retired card board's grammar (subway/subwayInteraction.ts):
//   - select mode: a bead is a checkbox, a station toggles its whole cell, the "+N"
//     roster names toggle too - so the bulk bar acts on a hand-picked cohort;
//   - otherwise a bead drags onto a legal station of its OWN line, or moves from its
//     Move-to menu (right-click, Shift+F10, the Menu key). Both inputs resolve
//     through commitDrop into the board's optimistic, CAS-guarded moveEntry, so the
//     keyboard twin cannot drift from the pointer. A refused move names the
//     affected bead and its reason.

import { useState } from "react";
import { UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { displayScoreOf } from "@/app/_lib/match-score";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { DEFAULT_BOARD_AXIS, entryLaneKey, type Entry, type Position } from "@/app/features/shared/pipelineTypes";
import { PipelineBoardOffAxisStrip } from "../PipelineBoardOffAxisStrip";
import { PipelineCandidateMenu } from "../PipelineCandidateMenu";
import type { MapBoardProps } from "./mapTypes";
import { LineRow, type LineInteraction } from "./subway/SubwayLineRow";
import { canDropOn, commitDrop, moveMenuItems, toggleCellSelection } from "./subway/subwayInteraction";
import { StationHeader, SubwayKey } from "./subway/SubwayMarks";
import { useSubwayModel } from "./subway/useSubwayModel";

type PipelineT = ReturnType<typeof useTranslations<"pipeline">>;

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/** The bead's tooltip: the name, then which of the 0–100 numbers this is (a
 *  work-sample TRANSFER score is never read as a match score — ONE THREAD gap 2). */
function beadTitle(entry: Entry, t: PipelineT): string {
  const display = displayScoreOf(entry);
  if (!display || display.score == null) return entry.candidateLabel;
  const suffix =
    display.kind === "transfer"
      ? `${t("candidateRow.transferSuffix", { score: display.score })} — ${t("scoreKind.transferTitle")}`
      : t("candidateRow.matchSuffix", { score: display.score });
  return `${entry.candidateLabel}${suffix}`;
}

export function PipelineBoardSubway({
  positions,
  entries,
  axis = DEFAULT_BOARD_AXIS,
  retiredStages = [],
  plan = null,
  rejectedByLane = {},
  onLineAction,
  onOpenRejected,
  openPositionRanking,
  openProfile,
  openJob,
  onMove,
  onOpenCell,
  openCell = null,
  openCandidate,
  bouncedEntryId,
  bouncedReason,
  selectMode = false,
  selectedIds,
  onToggleSelect,
  onUpdateSelection,
}: MapBoardProps) {
  // The bead being dragged (the drop reads it from here, not from dataTransfer), and
  // the open Move-to menu with the cohort its "Open" item pages through.
  const [dragging, setDragging] = useState<Entry | null>(null);
  const [menu, setMenu] = useState<{ entry: Entry; cohort: readonly Entry[]; at: { x: number; y: number } } | null>(
    null,
  );
  const t = useTranslations("pipeline");
  const enumLabel = useEnumLabel();
  const { columns, cellsByLane, stranded, attentionByLane, gridStyle, minWidth, terminal } = useSubwayModel(
    positions,
    entries,
    axis,
    plan,
  );

  // Stage help + label resolution, identical to the baseline: a workspace's own
  // label wins, a shipped stage resolves through the four-locale enum catalog.
  const stageHelp = (s: string): string => {
    const k = `stageHelp.${s}` as Parameters<typeof t>[0];
    return t.has(k) ? t(k) : (axis.find((stage) => stage.id === s)?.label ?? s);
  };
  const stageLabel = (stage: StageDef): string =>
    stage.label === stage.id ? enumLabel("stage", stage.id) : stage.label;
  const titleOf = (e: Entry) => beadTitle(e, t);
  const labelOf = (e: Entry) => t("candidateRow.menuFor", { name: e.candidateLabel });

  const mode = { selectMode };
  const picked = selectedIds ?? EMPTY_SELECTION;
  // One line's view of the interaction state. `move` is absent when the board cannot
  // move (no onMove) or is selecting - then there is no drag and no Move-to menu.
  const interactionFor = (pos: Position): LineInteraction => ({
    selectMode,
    selectedIds: picked,
    onToggleSelect,
    onSelectCell: onUpdateSelection ? (cell) => onUpdateSelection((cur) => toggleCellSelection(cur, cell)) : undefined,
    selectLabel: (e) => t("candidateRow.selectCandidate", { name: e.candidateLabel }),
    cellSelectAria: (stage, count) => t("board.cellSelect", { position: pos.title, stage, count }),
    move:
      onMove && !selectMode
        ? {
            menuHint: t("candidateRow.menuHint"),
            dropRefused: t("board.dropRefused"),
            dragging: dragging && entryLaneKey(dragging) === pos.id ? dragging : null,
            canDrop: (stageId) => (dragging ? canDropOn(dragging, { positionId: pos.id, stageId }, axis) : false),
            onDrag: setDragging,
            onDrop: (stageId) => {
              if (dragging) commitDrop(dragging, { positionId: pos.id, stageId }, axis, mode, onMove);
              setDragging(null);
            },
            onMenu: (entry, cohort, at) => setMenu({ entry, cohort, at }),
          }
        : null,
  });

  return (
    <section>
      <div tabIndex={0} role="region" aria-label={t("board.boardAria")} className="focus-ring overflow-x-auto bg-white">
        <div
          style={minWidth}
          role="grid"
          aria-label={t("board.gridAria")}
          aria-colcount={columns.length + 1}
          aria-rowcount={positions.length + 1}
        >
          <StationHeader
            axis={axis}
            label={stageLabel}
            help={stageHelp}
            gridStyle={gridStyle}
            lineColLabel={t("board.position")}
          />
          {positions.map((pos) => {
            const attention = attentionByLane.get(pos.id) ?? { human: 0, ai: 0 };
            const rejectedCount = rejectedByLane[pos.id] ?? 0;
            return (
            <LineRow
              key={pos.id}
              interaction={interactionFor(pos)}
              position={pos}
              axis={axis}
              cells={cellsByLane.get(pos.id) ?? columns.map(() => [] as Entry[])}
              attention={attention}
              gridStyle={gridStyle}
              openCell={openCell}
              terminal={terminal}
              cellAria={(stage, count) =>
                t("board.cellAria", { position: pos.title, stage, count })
              }
              cellEmpty={t("board.cellEmpty")}
              stageLabel={stageLabel}
              labels={{
                active: t("board.active", { count: pos.count }),
                openJd: t("board.openJd"),
                rank: t("board.rankCandidates"),
                waiting: `${t("board.waitingHuman", { count: attention.human })} · ${t("board.waitingAi", { count: attention.ai })}`,
                rejected: t("board.rejectedCount", { count: rejectedCount, position: pos.title }),
              }}
              rejectedCount={rejectedCount}
              onOpenRejected={(origin) => onOpenRejected(pos, origin)}
              onLineAction={onLineAction ? (action) => onLineAction(pos, action) : undefined}
              beadTitle={titleOf}
              beadLabel={labelOf}
              onOpenCell={onOpenCell}
              openJob={openJob}
              openPositionRanking={openPositionRanking}
              openCandidate={openCandidate}
              bouncedEntryId={bouncedEntryId}
              bouncedReason={bouncedReason}
            />
            );
          })}
        </div>
      </div>
      <SubwayKey />

      {/* A bead's Move-to menu - the keyboard/right-click twin of the drag. Its items
          carry the DropTarget the drag would hit, so a pick rides commitDrop too. */}
      {menu && onMove && !selectMode ? (
        <PipelineCandidateMenu
          at={menu.at}
          ariaLabel={t("candidateRow.menuFor", { name: menu.entry.candidateLabel })}
          onClose={() => setMenu(null)}
          sections={[
            {
              id: "open",
              items: [
                {
                  id: "open",
                  label: t("candidateRow.openProfile"),
                  Icon: UserRound,
                  onSelect: () => openCandidate(menu.entry, menu.cohort),
                },
              ],
            },
            {
              id: "move",
              label: t("candidateRow.moveTo"),
              items: moveMenuItems(menu.entry, axis, (id) => enumLabel("stage", id)).map((item) => ({
                id: item.id,
                label: item.label,
                onSelect: () => void commitDrop(menu.entry, item.target, axis, mode, onMove),
              })),
            },
          ]}
        />
      ) : null}

      {/* Candidates standing on a column this board does not draw — loud by
          design, exactly as on the baseline board. */}
      {stranded.length > 0 ? (
        <PipelineBoardOffAxisStrip
          entries={stranded}
          retiredStages={retiredStages}
          openProfile={openProfile}
          onMove={onMove}
          axis={axis}
        />
      ) : null}
    </section>
  );
}
