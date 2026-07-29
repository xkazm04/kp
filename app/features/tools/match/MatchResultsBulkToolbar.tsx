"use client";

// Bulk shortlist/compare toolbar (tick roles, add-all, shortlist-top-N, compare
// toggle), split out of MatchResults.tsx.
import { useTranslations } from "next-intl";
import { Scale } from "lucide-react";

export function MatchResultsBulkToolbar({
  selectedCount,
  addableCount,
  bulkBusy,
  comparing,
  onAddSelected,
  onShortlistTop,
  onToggleComparing,
  onClearSelected,
}: {
  selectedCount: number;
  addableCount: number;
  bulkBusy: boolean;
  comparing: boolean;
  onAddSelected: () => void;
  onShortlistTop: (n: number) => void;
  onToggleComparing: () => void;
  onClearSelected: () => void;
}) {
  const t = useTranslations("match.results");
  const topN = Math.min(5, addableCount);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-stone-200 bg-paper px-3 py-2">
      <span className="text-sm font-semibold text-ink">
        {selectedCount > 0 ? t("selectedCount", { count: selectedCount }) : t("shortlistRoles")}
      </span>
      <button
        type="button"
        onClick={onAddSelected}
        disabled={selectedCount === 0 || bulkBusy}
        className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-ink/90 disabled:opacity-40"
      >
        {bulkBusy ? t("adding") : selectedCount > 0 ? t("addN", { count: selectedCount }) : t("addToPipeline")}
      </button>
      <button
        type="button"
        onClick={() => onShortlistTop(topN)}
        disabled={bulkBusy}
        className="focus-ring inline-flex h-8 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-40"
      >
        {t("shortlistTopN", { n: topN })}
      </button>
      {/* MAT5: compare the ticked roles side by side (2–4 reads best). */}
      {selectedCount >= 2 && selectedCount <= 4 ? (
        <button
          type="button"
          onClick={onToggleComparing}
          aria-pressed={comparing}
          className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold ${
            comparing ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-ink hover:bg-paper"
          }`}
        >
          <Scale size={14} /> {t("compareN", { count: selectedCount })}
        </button>
      ) : null}
      {selectedCount > 0 ? (
        <button
          type="button"
          onClick={onClearSelected}
          disabled={bulkBusy}
          className="focus-ring inline-flex h-8 items-center rounded-md px-2 text-sm font-semibold text-steel hover:text-ink disabled:opacity-40"
        >
          {t("clear")}
        </button>
      ) : null}
      <span className="text-meta text-steel">{t("tickHint")}</span>
    </div>
  );
}
