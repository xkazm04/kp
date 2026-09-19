"use client";

// The "AI recommendations" section: the batch select/accept/reject bar
// (Direction 1) plus the decisions LEDGER — one row per recommendation
// (ledger/DecisionsLedger.tsx: grouped by role, quick accept/reject and the modal
// door on every row), in place of the card grid.
import { ListChecks, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { DecisionsLedger } from "./ledger/DecisionsLedger";
import { DecisionsBatchBar, type DecisionsBatchBarProps } from "./DecisionsBatchBar";
import type { Entry } from "@/app/features/shared/decisionsTypes";

export function DecisionsAiReviewsSection({
  visibleAiReviews,
  selectMode,
  setSelectMode,
  selectableReviews,
  selectedReviewIds,
  toggleReviewSelect,
  exitSelectMode,
  leavingWrapClass,
  act,
  onDecide,
  staleSinceOf,
  ...batch
}: DecisionsBatchBarProps & {
  visibleAiReviews: Entry[];
  selectMode: boolean;
  setSelectMode: (v: boolean) => void;
  selectedReviewIds: ReadonlySet<string>;
  toggleReviewSelect: (e: Entry) => void;
  exitSelectMode: () => void;
  leavingWrapClass: (e: Entry) => string;
  act: (e: Entry, action: "accept" | "reject" | "approve_event", detail?: string, ttlDays?: number) => void;
  /** Open the candidate modal with this recommendation to rule on. */
  onDecide: (e: Entry) => void;
  staleSinceOf: (e: Entry) => string | null;
}) {
  const t = useTranslations("decisions");
  if (visibleAiReviews.length === 0) return null;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <Sparkles size={13} className="text-coral" /> {t("aiRecommendations")} <span className="text-coral">· {visibleAiReviews.length}</span>
        </h3>
        {/* Direction 1 — batch accept/reject. Offered when 2+ rows are batchable
            (offer_review excluded); a single row is faster one-by-one. Once armed,
            the toggle stays so the recruiter can always exit. */}
        {selectMode || selectableReviews.length > 1 ? (
          <button
            type="button"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            aria-pressed={selectMode}
            className={`focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold ${
              selectMode ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel hover:bg-stone-50"
            }`}
          >
            <ListChecks size={13} /> {selectMode ? t("batch.exit") : t("batch.select")}
          </button>
        ) : null}
      </div>

      {selectMode ? <DecisionsBatchBar selectableReviews={selectableReviews} {...batch} /> : null}

      <DecisionsLedger
        entries={visibleAiReviews}
        staleSinceOf={staleSinceOf}
        selectMode={selectMode}
        selectedIds={selectedReviewIds}
        onToggleSelect={toggleReviewSelect}
        leavingWrapClass={leavingWrapClass}
        onDecide={onDecide}
        act={(e, action) => act(e, action)}
      />
    </section>
  );
}
