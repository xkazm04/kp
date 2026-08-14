"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { Legend } from "./PipelineShared";
import { bucketLaneEntries, offAxisEntries } from "./pipelineBoardLayout";
import { moveTargetStages } from "./pipelineMoveTargets";
import { StageCell } from "./PipelineBoardStageCell";
import { PipelineBoardToolbar } from "./PipelineBoardToolbar";
import { PipelineBoardOffAxisStrip } from "./PipelineBoardOffAxisStrip";
import { usePipelineBoardScroll } from "./usePipelineBoardScroll";
import { boardGrid, boardMinWidth, EMPTY_SELECTION } from "./pipelineBoardGrid";
import { STAGE_HELP, type Entry, type Position } from "@/app/features/shared/pipelineTypes";
import { DEFAULT_BOARD_AXIS } from "@/app/features/shared/pipelineTypes";

export function PipelineBoard({
  positions,
  entries,
  axis = DEFAULT_BOARD_AXIS,
  retiredStages = [],
  isStale,
  openPositionRanking,
  openProfile,
  openJob,
  openActions,
  selectMode = false,
  selectedIds,
  onToggleSelect,
  onMove,
}: {
  positions: Position[];
  entries: Entry[];
  /** The columns THIS WORKSPACE renders, from GET /api/pipeline. Defaults to the
   *  shipped axis so a caller that has not threaded it through still works. */
  axis?: readonly StageDef[];
  /** Columns the workspace has dropped — used to NAME a stranded candidate's
   *  stage in the off-axis strip instead of showing a bare id. */
  retiredStages?: readonly StageDef[];
  isStale: (e: Entry) => boolean;
  openPositionRanking: (jobId: string) => void;
  openProfile: (e: Entry) => void;
  openJob: (jobId: string) => void;
  openActions: (e: Entry) => void;
  // PIPE1 — bulk select mode (owned by PipelineTab; the board just renders it).
  selectMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (e: Entry) => void;
  // cea12908 — when provided (and not in select mode), candidates can be dragged
  // between stage columns; the board calls this with the dragged entry + target stage.
  onMove?: (entry: Entry, toStage: string) => void;
}) {
  const t = useTranslations("pipeline");
  const enumLabel = useEnumLabel();
  const columns = useMemo(() => axis.map((s) => s.id), [axis]);
  // Bucket every entry into its [lane][stage] cell in ONE memoized pass — replaces
  // the per-position × per-stage `lane.filter(...)` that re-scanned the whole entry
  // list for every cell each render.
  const cellsByLane = useMemo(() => bucketLaneEntries(positions, entries, columns), [positions, entries, columns]);
  // Candidates standing on a column this board does not render — a retired stage,
  // or a legacy one. Surfaced in their own strip rather than folded into column 0
  // (see pipelineBoardLayout): under an editable axis, a silent fold would make a
  // removed column look like a mass reset to the top of the funnel.
  const stranded = useMemo(() => offAxisEntries(entries, columns), [entries, columns]);
  const grid = useMemo(() => boardGrid(columns.length), [columns.length]);
  const minWidth = useMemo(() => boardMinWidth(columns.length), [columns.length]);
  // The candidate currently being dragged (pointer DnD). Lifted here so any cell's
  // drop can resolve the source row regardless of which column started the drag.
  const [dragging, setDragging] = useState<Entry | null>(null);
  const dragEnabled = !!onMove && !selectMode;
  const { scrollRef, centerColumn, scrollByColumn, onBoardDragOver, stopAutoScroll } = usePipelineBoardScroll(dragEnabled);
  // bug-ui pipeline #1 — the polite live-region text narrating a stage change so a
  // screen-reader user hears the outcome of a keyboard (or drag) move even though
  // the moved card silently re-renders into another column.
  const [announce, setAnnounce] = useState("");
  // ONE move path for BOTH the drop and the per-card "Move to…" menu: announce,
  // then delegate to the caller's onMove (the optimistic set_stage). Same-stage is
  // a no-op. We narrate optimistically only for a target the server can accept
  // (moveTargetStages excludes Hired) — a drag onto a rejected column still calls
  // onMove so its 422 surfaces, but we don't announce a success that rolls back.
  const handleMove = (entry: Entry, toStage: string) => {
    if (entry.stage === toStage) return;
    if (moveTargetStages(entry.stage, axis).includes(toStage)) {
      setAnnounce(t("board.movedAnnounce", { name: entry.candidateLabel, stage: enumLabel("stage", toStage) }));
    }
    onMove?.(entry, toStage);
  };
  // Stage help tooltip: catalog `stageHelp.<stage>`, falling back to the English
  // STAGE_HELP source (then the raw stage) for any unmapped stage. A
  // workspace-invented column has no catalog entry and no help text — the raw id
  // is the honest fallback, and the recruiter named it themselves.
  const stageHelp = (s: string): string => {
    const k = `stageHelp.${s}` as Parameters<typeof t>[0];
    return t.has(k) ? t(k) : STAGE_HELP[s] ?? s;
  };
  // A shipped stage renders through the shared enum catalog (localized in four
  // locales); a workspace-authored one renders its own stored label. `label ===
  // id` marks a stage the workspace has not renamed, which is exactly the set the
  // catalog covers.
  const stageColumnLabel = (stage: StageDef): string =>
    stage.label === stage.id ? enumLabel("stage", stage.id) : stage.label;

  return (
    // No panel chrome of its own: the board is now the bottom layer of the board
    // PANEL that also carries the filter header (PipelineFilterBar), so a second
    // rounded border here would draw a card inside a card.
    <section>
      {/* bug-ui pipeline #1 — polite live region narrating stage moves (keyboard or
          drag). Stable across the board's re-renders so a text change is announced. */}
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
      <PipelineBoardToolbar t={t} dragEnabled={dragEnabled} onScrollByColumn={scrollByColumn} />
      <div
        ref={scrollRef}
        tabIndex={0}
        role="region"
        aria-label={t("board.boardAria")}
        // bug-ui pipeline #4 — edge auto-scroll during a card drag. The container
        // itself is not a drop target (no preventDefault here); it only reads the
        // pointer position from the bubbled dragover and stops the loop when the
        // drag ends (drop / dragend) or the pointer truly leaves the board.
        onDragOver={onBoardDragOver}
        onDrop={stopAutoScroll}
        onDragEnd={stopAutoScroll}
        onDragLeave={(ev) => {
          if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) stopAutoScroll();
        }}
        className="focus-ring overflow-x-auto bg-white"
      >
        <div style={minWidth}>
          <div className="grid border-b border-stone-200 bg-paper" style={grid}>
            <div className="sticky left-0 z-20 border-r border-stone-200 bg-paper px-3 py-2 text-meta uppercase text-steel">{t("board.position")}</div>
            {axis.map((stage, i) => (
              <button
                key={stage.id}
                type="button"
                data-stage-header
                onClick={centerColumn}
                title={stageHelp(stage.id)}
                className="focus-ring cursor-pointer border-r border-stone-200 px-3 py-2 text-center text-meta uppercase text-steel transition-colors last:border-0 hover:bg-stone-100 hover:text-coral"
              >
                {/* A workspace's own label wins; the shipped stages keep resolving
                    through enums.stage.* so they stay localized in four locales.
                    A renamed column is the recruiter's own words, untranslated —
                    which is correct: nobody else authored them. */}
                <span className="text-stone-400">{i + 1}.</span> {stageColumnLabel(stage)}
              </button>
            ))}
          </div>
          {positions.map((pos) => {
            // The lane's per-stage cells, precomputed by bucketLaneEntries (keyed by
            // the shared entryLaneKey so lane membership is provably the same
            // derivation as the lane COUNT in PipelineTab.groupPositions — a 2-way vs
            // 3-way fallback mismatch once counted an entry under "?" but placed it in
            // no lane). Empty per-stage arrays fall back if the lane somehow vanished.
            const laneCells = cellsByLane.get(pos.id) ?? columns.map(() => [] as Entry[]);
            return (
              <div key={pos.id} className="grid border-b border-stone-200 last:border-0" style={grid}>
                <div className="sticky left-0 z-10 border-r border-stone-200 bg-white px-3 py-3">
                  <button
                    type="button"
                    onClick={() => openJob(pos.id)}
                    title={t("board.openJd")}
                    className="focus-ring text-left text-base font-semibold leading-tight text-ink hover:text-coral"
                  >
                    {pos.title}
                  </button>
                  <p className="text-sm text-steel">{t("board.active", { count: pos.count })}</p>
                  <button
                    type="button"
                    onClick={() => openPositionRanking(pos.id)}
                    className="focus-ring mt-1 text-sm font-semibold text-coral hover:underline"
                  >
                    {t("board.rankCandidates")}
                  </button>
                </div>
                {columns.map((stage, i) => {
                  // Precomputed by bucketLaneEntries. An entry whose stage is not a
                  // column here lands in NO cell — it is rendered by the off-axis
                  // strip below instead of being folded into column 0.
                  const cellEntries = laneCells[i];
                  // Key by stage ONLY (stable across polls) — the "+N more" expansion
                  // is now reset by a render-phase population-change check inside
                  // StageCell, so an unrelated live-refresh no longer remounts the cell
                  // (which collapsed the overflow mid-read and churned the DOM).
                  return (
                    <StageCell
                      key={stage}
                      stage={stage}
                      entries={cellEntries}
                      isStale={isStale}
                      openProfile={openProfile}
                      openActions={openActions}
                      selectMode={selectMode}
                      selectedIds={selectedIds ?? EMPTY_SELECTION}
                      onToggleSelect={onToggleSelect ?? (() => undefined)}
                      dragEnabled={dragEnabled}
                      isDragging={!!dragging}
                      onDragStartEntry={setDragging}
                      onDragEndEntry={() => setDragging(null)}
                      onMoveEntry={handleMove}
                      onDropToStage={(toStage) => {
                        // Resolve the dragged entry from board state and funnel the
                        // drop through the SAME move+announce path the menu uses.
                        // handleMove ignores a same-stage (no-op) drop.
                        if (dragging) handleMove(dragging, toStage);
                        setDragging(null);
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {/* Candidates on a column this board no longer draws. Loud by design: the
          only alternative is losing track of them. */}
      {stranded.length > 0 ? (
        <PipelineBoardOffAxisStrip
          entries={stranded}
          retiredStages={retiredStages}
          openProfile={openProfile}
          onMove={onMove ? handleMove : undefined}
          axis={axis}
        />
      ) : null}

      <div className="border-t border-stone-200 px-4 py-2.5">
        <Legend />
      </div>
    </section>
  );
}
