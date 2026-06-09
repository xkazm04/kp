"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { CandidateRow, Legend } from "./PipelineShared";
import { STAGE_HELP, STAGES, type Entry } from "./PipelineTypes";

type Position = { id: string; title: string; family: string; count: number };

const CELL_LIMIT = 6;

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
  entries,
  isStale,
  openProfile,
  openActions,
}: {
  entries: Entry[];
  isStale: (e: Entry) => boolean;
  openProfile: (e: Entry) => void;
  openActions: (e: Entry) => void;
}) {
  const t = useTranslations("pipeline");
  const [expanded, setExpanded] = useState(false);
  const overflow = entries.length - CELL_LIMIT;
  const visible = expanded ? entries : entries.slice(0, CELL_LIMIT);
  return (
    <div className="space-y-0.5 border-r border-stone-200 px-1.5 py-2 last:border-0">
      {visible.map((e) => (
        <CandidateRow
          key={e.id}
          entry={e}
          pending={needsHumanDecision(e.approvalKind)}
          stale={isStale(e)}
          onOpen={() => openProfile(e)}
          onActions={() => openActions(e)}
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
}: {
  positions: Position[];
  entries: Entry[];
  isStale: (e: Entry) => boolean;
  openPositionRanking: (jobId: string) => void;
  openProfile: (e: Entry) => void;
  openJob: (jobId: string) => void;
  openActions: (e: Entry) => void;
}) {
  const t = useTranslations("pipeline");
  const enumLabel = useEnumLabel();
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-meta uppercase tracking-wide text-steel">{t("board.positions")}</h3>
        <div className="flex items-center gap-2">
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
            // Match the position-key derivation exactly (PipelineTab uses a 3-way
            // `?? "?"` fallback). The 2-way fallback here disagreed precisely when
            // both job fields are null, counting the entry under "?" but placing it
            // in no lane.
            const lane = entries.filter((e) => (e.jobId ?? e.jobTitle ?? "?") === pos.id);
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
                      entries={cellEntries}
                      isStale={isStale}
                      openProfile={openProfile}
                      openActions={openActions}
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
