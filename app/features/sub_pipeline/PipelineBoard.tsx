"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { CandidateRow, Legend } from "./PipelineShared";
import { moveTargetStages } from "./pipeline-move-targets";
import { entryLaneKey, STAGE_HELP, STAGES, type Entry, type Position } from "./PipelineTypes";

const CELL_LIMIT = 6;
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

// Board layout is DERIVED from the stage list so it can never drift out of sync
// with STAGES. A hardcoded grid-cols repeat(7) + min-w-[2240px] previously painted
// two empty phantom columns after the 7→5 stage consolidation; computing both from
// STAGES.length makes the board self-adjust to any future stage add/remove.
const POSITION_COL = 240; // px — the sticky leading "Position" column
const STAGE_COL = 280; // px — the min width of each stage column
const BOARD_GRID: React.CSSProperties = {
  gridTemplateColumns: `${POSITION_COL}px repeat(${STAGES.length}, minmax(${STAGE_COL}px, 1fr))`,
};
const BOARD_MIN_WIDTH: React.CSSProperties = { minWidth: POSITION_COL + STAGES.length * STAGE_COL };

// Dev-time guard: the grid must carry exactly one track per stage (plus the leading
// position column), so the derived template can never silently decouple from
// STAGES.length the way the old hardcoded repeat(7) did.
if (process.env.NODE_ENV !== "production") {
  const stageTracks = Number(/repeat\((\d+),/.exec(String(BOARD_GRID.gridTemplateColumns))?.[1]);
  console.assert(
    stageTracks === STAGES.length,
    `[PipelineBoard] grid stage tracks (${stageTracks}) must equal STAGES.length (${STAGES.length})`
  );
}

// One stage cell. The overflow control is a real focusable button (was a
// title-only <p>) so keyboard/touch users can reveal the hidden candidates,
// which then render as the same navigable CandidateRows.
function StageCell({
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
}) {
  const t = useTranslations("pipeline");
  const [expanded, setExpanded] = useState(false);
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
  // The candidate currently being dragged (pointer DnD). Lifted here so any cell's
  // drop can resolve the source row regardless of which column started the drag.
  const [dragging, setDragging] = useState<Entry | null>(null);
  const dragEnabled = !!onMove && !selectMode;
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Click a stage header to glide that column to the centre of the viewport, so
  // a wide pipeline is navigable left↔right without dragging the scrollbar.
  const centerColumn = (e: React.MouseEvent<HTMLButtonElement>) => {
    const container = scrollRef.current;
    if (!container) return;
    const cell = e.currentTarget;
    const delta =
      cell.getBoundingClientRect().left -
      container.getBoundingClientRect().left -
      (container.clientWidth - cell.clientWidth) / 2;
    container.scrollBy({ left: delta, behavior: "smooth" });
  };

  // Page the board one stage column at a time via the ◀/▶ controls.
  const scrollByColumn = (dir: -1 | 1) => {
    const container = scrollRef.current;
    if (!container) return;
    const col = container.querySelector<HTMLElement>("[data-stage-header]");
    const step = col?.clientWidth ?? Math.round(container.clientWidth * 0.6);
    container.scrollBy({ left: dir * step, behavior: "smooth" });
  };

  return (
    <section className="space-y-3">
      {/* bug-ui pipeline #1 — polite live region narrating stage moves (keyboard or
          drag). Stable across the board's re-renders so a text change is announced. */}
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-meta uppercase tracking-wide text-steel">{t("board.positions")}</h3>
        <div className="flex items-center gap-2">
          {dragEnabled ? <span className="hidden text-sm text-steel md:inline">{t("board.dragHint")}</span> : null}
          <span className="hidden text-sm text-steel sm:inline">{t("board.scrollHint")}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollByColumn(-1)}
              aria-label={t("board.scrollLeft")}
              className="focus-ring inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-stone-200 text-steel transition-colors hover:border-coral/40 hover:bg-stone-100 hover:text-coral"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => scrollByColumn(1)}
              aria-label={t("board.scrollRight")}
              className="focus-ring inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-stone-200 text-steel transition-colors hover:border-coral/40 hover:bg-stone-100 hover:text-coral"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
      <div
        ref={scrollRef}
        tabIndex={0}
        role="region"
        aria-label={t("board.boardAria")}
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
            // Keyed by the shared entryLaneKey so lane membership here is provably
            // the same derivation as the lane COUNT in PipelineTab.groupPositions —
            // a 2-way vs 3-way fallback mismatch once counted an entry under "?" but
            // placed it in no lane.
            const lane = entries.filter((e) => entryLaneKey(e) === pos.id);
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
                  // An entry whose stage isn't a known column (a legacy / unmapped
                  // stage) would otherwise match no cell and vanish while still
                  // counted — fold it into the first column so it stays visible and
                  // actionable rather than becoming an invisible, unreachable row.
                  const cellEntries = lane.filter(
                    (e) => e.stage === stage || (i === 0 && !(STAGES as readonly string[]).includes(e.stage))
                  );
                  // Fold the cell's contents into the key so the cell REMOUNTS (resetting its
                  // local "+N more" expansion) when search/filter/live-refresh swaps this lane's
                  // population — otherwise an expanded cell shows a different set than the user
                  // expanded and the collapse toggle can silently vanish mid-interaction.
                  return (
                    <StageCell
                      key={`${stage}:${cellEntries.map((e) => e.id).join(",")}`}
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
