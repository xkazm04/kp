"use client";

// The board's small top toolbar: the "Positions" heading, the drag/scroll hint
// text, and the ◀/▶ column-paging controls. Split out of PipelineBoard.tsx.

import type { PipelineTranslator } from "./pipelineTranslator";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function PipelineBoardToolbar({
  t,
  dragEnabled,
  onScrollByColumn,
}: {
  t: PipelineTranslator;
  dragEnabled: boolean;
  onScrollByColumn: (dir: -1 | 1) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-meta uppercase tracking-wide text-steel">{t("board.positions")}</h3>
      <div className="flex items-center gap-2">
        {dragEnabled ? <span className="hidden text-sm text-steel md:inline">{t("board.dragHint")}</span> : null}
        <span className="hidden text-sm text-steel sm:inline">{t("board.scrollHint")}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onScrollByColumn(-1)}
            aria-label={t("board.scrollLeft")}
            className="focus-ring inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-stone-200 text-steel transition-colors hover:border-coral/40 hover:bg-stone-100 hover:text-coral"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => onScrollByColumn(1)}
            aria-label={t("board.scrollRight")}
            className="focus-ring inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-stone-200 text-steel transition-colors hover:border-coral/40 hover:bg-stone-100 hover:text-coral"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
