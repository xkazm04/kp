"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { Legend } from "./PipelineShared";
import { bucketLaneEntries } from "./pipelineBoardLayout";
import { moveTargetStages } from "./pipelineMoveTargets";
import { StageCell } from "./PipelineBoardStageCell";
import { PipelineBoardToolbar } from "./PipelineBoardToolbar";
import { usePipelineBoardScroll } from "./usePipelineBoardScroll";
import { BOARD_GRID, BOARD_MIN_WIDTH, EMPTY_SELECTION } from "./pipelineBoardGrid";
import { STAGE_HELP, STAGES, type Entry, type Position } from "@/app/features/shared/pipelineTypes";

export function PipelineBoard({
  positions,
  entries,
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
  // Bucket every entry into its [lane][stage] cell in ONE memoized pass — replaces
  // the per-position × per-stage `lane.filter(...)` that re-scanned the whole entry
  // list for every cell each render.
  const cellsByLane = useMemo(() => bucketLaneEntries(positions, entries), [positions, entries]);
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
    if (moveTargetStages(entry.stage).includes(toStage)) {
      setAnnounce(t("board.movedAnnounce", { name: entry.candidateLabel, stage: enumLabel("stage", toStage) }));
    }
    onMove?.(entry, toStage);
  };
  // Stage help tooltip: catalog `stageHelp.<stage>`, falling back to the English
  // STAGE_HELP source (then the raw stage) for any unmapped stage.
  const stageHelp = (s: string): string => {
    const k = `stageHelp.${s}` as Parameters<typeof t>[0];
    return t.has(k) ? t(k) : STAGE_HELP[s] ?? s;
  };

  return (
    <section className="space-y-3">
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
        className="focus-ring overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-panel"
      >
        <div style={BOARD_MIN_WIDTH}>
          <div className="grid border-b border-stone-200 bg-paper" style={BOARD_GRID}>
            <div className="sticky left-0 z-20 border-r border-stone-200 bg-paper px-3 py-2 text-meta uppercase text-steel">{t("board.position")}</div>
            {STAGES.map((s, i) => (
              <button
                key={s}
                type="button"
                data-stage-header
                onClick={centerColumn}
                title={stageHelp(s)}
                className="focus-ring cursor-pointer border-r border-stone-200 px-3 py-2 text-center text-meta uppercase text-steel transition-colors last:border-0 hover:bg-stone-100 hover:text-coral"
              >
                <span className="text-stone-400">{i + 1}.</span> {enumLabel("stage", s)}
              </button>
            ))}
          </div>
          {positions.map((pos) => {
            // The lane's per-stage cells, precomputed by bucketLaneEntries (keyed by
            // the shared entryLaneKey so lane membership is provably the same
            // derivation as the lane COUNT in PipelineTab.groupPositions — a 2-way vs
            // 3-way fallback mismatch once counted an entry under "?" but placed it in
            // no lane). Empty per-stage arrays fall back if the lane somehow vanished.
            const laneCells = cellsByLane.get(pos.id) ?? STAGES.map(() => [] as Entry[]);
            return (
              <div key={pos.id} className="grid border-b border-stone-200 last:border-0" style={BOARD_GRID}>
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
                {STAGES.map((stage, i) => {
                  // Precomputed by bucketLaneEntries: the entry whose stage isn't a
                  // known column is already folded into the first column (index 0) so
                  // it stays visible + actionable rather than vanishing while counted.
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
      <Legend />
    </section>
  );
}
