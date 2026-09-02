"use client";

// The board's small top toolbar: the drag/scroll hint text and the ◀/▶
// column-paging controls. Split out of PipelineBoard.tsx.
//
// The "Positions" heading moved up into the board panel's header (PipelineFilterBar),
// which now names the board and carries its search + facets — so this strip is left
// with exactly what it is about: getting around the horizontal scroll.

import type { PipelineTranslator } from "./pipelineTranslator";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function PipelineBoardToolbar({
  t,
  dragEnabled,
  onScrollByColumn,
  canScrollLeft,
  canScrollRight,
}: {
  t: PipelineTranslator;
  dragEnabled: boolean;
  onScrollByColumn: (dir: -1 | 1) => void;
  /** Is there anywhere left to page? A control that cannot do anything says so
   *  rather than swallowing the click (board-grid-has-a-name). */
  canScrollLeft: boolean;
  canScrollRight: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2">
      <div className="flex items-center gap-2">
        {dragEnabled ? <span className="hidden text-sm text-steel md:inline">{t("board.dragHint")}</span> : null}
        <span className="hidden text-sm text-steel sm:inline">{t("board.scrollHint")}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onScrollByColumn(-1)}
            disabled={!canScrollLeft}
            aria-label={t("board.scrollLeft")}
            className="focus-ring inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-stone-200 text-steel transition-colors hover:border-coral/40 hover:bg-stone-100 hover:text-coral disabled:cursor-default disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:bg-transparent disabled:hover:text-steel"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => onScrollByColumn(1)}
            disabled={!canScrollRight}
            aria-label={t("board.scrollRight")}
            className="focus-ring inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-stone-200 text-steel transition-colors hover:border-coral/40 hover:bg-stone-100 hover:text-coral disabled:cursor-default disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:bg-transparent disabled:hover:text-steel"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
