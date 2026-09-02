"use client";

import { Check, X } from "lucide-react";
import type { useTranslations } from "next-intl";

// The bulk-shortlist action bar (MAT3 matrix half): shows the selection count,
// the add-to-pipeline button, a clear, and an exit. Split out of MatrixTab.tsx
// to keep that file under the 200-line cap.
export function MatrixSelectBar({
  selectedSize,
  selectedOutsideCount,
  adding,
  addSelected,
  clearSelected,
  exitSelect,
  t,
}: {
  selectedSize: number;
  /** How many selected cells the current view hides (matrix-shortlist-acts-on-what-you-see).
   *  The grid keeps the selection across filter/floor/scope changes on purpose, so the bar
   *  owes the recruiter this number before "Add N" files the lot. */
  selectedOutsideCount: number;
  adding: boolean;
  addSelected: () => void;
  clearSelected: () => void;
  exitSelect: () => void;
  t: ReturnType<typeof useTranslations<"matrix">>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-coral/30 bg-coral/5 px-3 py-2">
      <span className="text-sm font-semibold text-ink">
        {selectedSize > 0 ? t("selectedCount", { count: selectedSize }) : t("tapToShortlist")}
      </span>
      {/* matrix-shortlist-acts-on-what-you-see — "5 selected" reads as "5 cells on this
          grid" when the role-family filter, the min-fit floor or a ?job= scope is hiding
          some of them. The selection is NOT pruned (the recruiter built it on purpose;
          see matrixSelection.ts), and "Add 5" below still names and files the FULL count
          — so the mismatch is stated here, before the click, in the bar's own coral
          warning register. role="status" so a screen reader hears it the moment a filter
          change creates the divergence. */}
      {selectedOutsideCount > 0 ? (
        <span role="status" className="text-sm font-semibold text-coral">
          {t("selectedOutsideView", { count: selectedOutsideCount })}
        </span>
      ) : null}
      <button
        type="button"
        onClick={addSelected}
        disabled={selectedSize === 0 || adding}
        className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-40"
      >
        <Check size={14} /> {adding ? t("adding") : selectedSize > 0 ? t("addN", { count: selectedSize }) : t("addToPipeline")}
      </button>
      {selectedSize > 0 ? (
        <button
          type="button"
          onClick={clearSelected}
          disabled={adding}
          className="focus-ring inline-flex h-8 items-center rounded-md px-2 text-sm font-semibold text-steel hover:text-ink disabled:opacity-40"
        >
          {t("clear")}
        </button>
      ) : null}
      <button
        type="button"
        onClick={exitSelect}
        className="focus-ring ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-semibold text-steel hover:text-ink"
      >
        <X size={13} /> {t("exit")}
      </button>
      <span className="w-full text-meta text-steel">{t("selectHint")}</span>
    </div>
  );
}
