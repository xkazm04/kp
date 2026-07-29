"use client";

import { Check, X } from "lucide-react";
import type { useTranslations } from "next-intl";

// The bulk-shortlist action bar (MAT3 matrix half): shows the selection count,
// the add-to-pipeline button, a clear, and an exit. Split out of MatrixTab.tsx
// to keep that file under the 200-line cap.
export function MatrixSelectBar({
  selectedSize,
  adding,
  addSelected,
  clearSelected,
  exitSelect,
  t,
}: {
  selectedSize: number;
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
