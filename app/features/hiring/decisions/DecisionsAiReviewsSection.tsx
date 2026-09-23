"use client";

// The "AI recommendations" section: the batch select/accept/reject bar
// (Direction 1) plus the decisions LEDGER — one row per recommendation
// (ledger/DecisionsLedger.tsx: grouped by role, quick accept/reject and the modal
// door on every row), in place of the card grid.
//
// decisions-review-ui/B — the ledger's quick reject ✕ no longer writes on the click.
// It ARMS the shared commit window (useDecisionCommitWindow.ts): the row leaves at
// once, DecisionsUndoStrip names who and counts the stated seconds, and the reject
// is committed only when the window closes (or the page goes away). Undo writes
// nothing. The rows the window holds are an OVERLAY subtracted here, so the live
// refresh keeps running for every other row; the header count still includes a
// pending row, which is true - it is still pending, and the strip says so.
import { useEffect, useMemo } from "react";
import { ListChecks, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { DecisionsUndoStrip } from "./DecisionsUndoStrip";
import { hiddenIds } from "./decisionsCommitWindow";
import {
  armDecision,
  dismissDecisionFailure,
  pruneLandedDecisions,
  undoDecision,
  useDecisionCommitWindow,
} from "./useDecisionCommitWindow";
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
  const commitWindow = useDecisionCommitWindow();
  const hidden = useMemo(() => hiddenIds(commitWindow), [commitWindow]);
  const shownReviews = useMemo(() => visibleAiReviews.filter((e) => !hidden.has(e.id)), [visibleAiReviews, hidden]);
  // A landed reject's overlay is dropped once the queue's read no longer lists it
  // (the commit's notifyDataChanged() triggers that read).
  const presentKey = visibleAiReviews.map((e) => e.id).join(",");
  useEffect(() => {
    pruneLandedDecisions(new Set(presentKey ? presentKey.split(",") : []));
  }, [presentKey]);
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

      <div className="mt-3">
        <DecisionsUndoStrip state={commitWindow} onUndo={undoDecision} onDismissFailure={dismissDecisionFailure} />
      </div>

      {selectMode ? <DecisionsBatchBar selectableReviews={selectableReviews} {...batch} /> : null}

      <DecisionsLedger
        entries={shownReviews}
        staleSinceOf={staleSinceOf}
        selectMode={selectMode}
        selectedIds={selectedReviewIds}
        onToggleSelect={toggleReviewSelect}
        leavingWrapClass={leavingWrapClass}
        onDecide={onDecide}
        act={(e, action) =>
          action === "reject"
            ? armDecision({ entryId: e.id, action, label: e.candidateLabel, expectedStage: e.stage })
            : act(e, action)
        }
      />
    </section>
  );
}
