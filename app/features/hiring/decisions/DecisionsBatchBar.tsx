"use client";

// The batch bar under the AI-recommendations heading: the selection count, select
// all / clear, the select-all drift cue, the offers-excluded note, the last batch
// result, and the accept / (armed) reject actions. Split out of the section so the
// ledger and the bar each stay under the file cap.
import { useTranslations } from "next-intl";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import { BTN_AFFIRM } from "@/app/_components/ui/recipes";

export type DecisionsBatchBarProps = {
  selectableReviews: Entry[];
  selectedReviews: Entry[];
  selectAllReviews: () => void;
  clearSelectedReviews: () => void;
  selectionDrift: number;
  hasOfferReviews: boolean;
  bulkResult: { ok: number; failed: number; verb: "accepted" | "rejected"; reason: string | null } | null;
  confirmingBulkReject: boolean;
  setConfirmingBulkReject: (v: boolean) => void;
  bulkBusy: boolean;
  bulkDecideReviews: (action: "accept" | "reject") => void;
};

const PILL =
  "focus-ring cursor-pointer rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink";

export function DecisionsBatchBar({
  selectableReviews,
  selectedReviews,
  selectAllReviews,
  clearSelectedReviews,
  selectionDrift,
  hasOfferReviews,
  bulkResult,
  confirmingBulkReject,
  setConfirmingBulkReject,
  bulkBusy,
  bulkDecideReviews,
}: DecisionsBatchBarProps) {
  const t = useTranslations("decisions");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-coral/30 bg-coral/5 px-3 py-2">
      <span className="text-sm font-semibold text-ink" aria-live="polite">
        {t("batch.selectedCount", { count: selectedReviews.length })}
      </span>
      <button type="button" onClick={selectAllReviews} className={PILL}>
        {t("batch.selectAll", { count: selectableReviews.length })}
      </button>
      {selectedReviews.length > 0 ? (
        <button type="button" onClick={clearSelectedReviews} className={PILL}>
          {t("batch.clear")}
        </button>
      ) : null}
      {/* Direction 3 — select-all drift cue: rows arrived since the recruiter
          selected all, so the current select-all is stale. Clicking re-selects. */}
      {selectionDrift > 0 ? (
        <button
          type="button"
          onClick={selectAllReviews}
          aria-live="polite"
          className="focus-ring inline-flex cursor-pointer items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
        >
          {t("batch.selectionDrift", { count: selectionDrift })}
        </button>
      ) : null}
      {hasOfferReviews ? <span className="text-sm text-steel">{t("batch.offersExcluded")}</span> : null}
      {bulkResult ? (
        <span role="status" className="text-sm">
          <span className="font-semibold text-moss">
            {t(bulkResult.verb === "accepted" ? "batch.accepted" : "batch.rejected", { count: bulkResult.ok })}
          </span>
          {bulkResult.failed > 0 ? (
            <span className="font-semibold text-coral">
              {" · "}
              {t("batch.failed", { count: bulkResult.failed })}
            </span>
          ) : null}
          {bulkResult.reason ? <span className="block text-steel">{bulkResult.reason}</span> : null}
        </span>
      ) : null}
      {selectedReviews.length > 0 ? (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void bulkDecideReviews("accept")} disabled={bulkBusy} className={`${BTN_AFFIRM} cursor-pointer px-3 py-1 text-sm`}>
            {bulkBusy ? t("batch.accepting") : t("batch.accept", { count: selectedReviews.length })}
          </button>
          {confirmingBulkReject ? (
            <>
              <span className="text-sm font-semibold text-coral">{t("batch.rejectConfirm", { count: selectedReviews.length })}</span>
              <button
                type="button"
                onClick={() => void bulkDecideReviews("reject")}
                disabled={bulkBusy}
                className="focus-ring cursor-pointer rounded-md bg-coral px-3 py-1 text-sm font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
              >
                {bulkBusy ? t("batch.rejecting") : t("batch.rejectConfirmYes")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingBulkReject(false)}
                disabled={bulkBusy}
                className="focus-ring cursor-pointer rounded-md px-2 py-1 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
              >
                {t("batch.rejectCancel")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingBulkReject(true)}
              disabled={bulkBusy}
              className="focus-ring cursor-pointer rounded-md border border-coral/40 bg-white px-3 py-1 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
            >
              {t("batch.reject", { count: selectedReviews.length })}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
