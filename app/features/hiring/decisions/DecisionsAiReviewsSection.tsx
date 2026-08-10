"use client";

// The "AI recommendations" section: the batch select/accept/reject bar
// (Direction 1) plus the AI-review card grid. Split out of DecisionsTab to
// keep that file's render shell under the 200-line cap.
import { ListChecks, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { AiReviewCard } from "./DecisionsAiReviewCard";
import type { JobPeerContext, PeerScore } from "./decisionsPeerCompare";
import type { Entry } from "@/app/features/shared/decisionsTypes";

export function DecisionsAiReviewsSection({
  visibleAiReviews,
  selectMode,
  setSelectMode,
  selectableReviews,
  selectedReviewIds,
  selectedReviews,
  toggleReviewSelect,
  exitSelectMode,
  selectAllReviews,
  clearSelectedReviews,
  selectionDrift,
  hasOfferReviews,
  bulkResult,
  confirmingBulkReject,
  setConfirmingBulkReject,
  bulkBusy,
  bulkDecideReviews,
  leavingWrapClass,
  act,
  setSummaryEntry,
  staleSinceOf,
  peersOf,
  peerFactsOf,
}: {
  visibleAiReviews: Entry[];
  selectMode: boolean;
  setSelectMode: (v: boolean) => void;
  selectableReviews: Entry[];
  selectedReviewIds: ReadonlySet<string>;
  selectedReviews: Entry[];
  toggleReviewSelect: (e: Entry) => void;
  exitSelectMode: () => void;
  selectAllReviews: () => void;
  clearSelectedReviews: () => void;
  selectionDrift: number;
  hasOfferReviews: boolean;
  bulkResult: { ok: number; failed: number; verb: "accepted" | "rejected"; reason: string | null } | null;
  confirmingBulkReject: boolean;
  setConfirmingBulkReject: (v: boolean) => void;
  bulkBusy: boolean;
  bulkDecideReviews: (action: "accept" | "reject") => void;
  leavingWrapClass: (e: Entry) => string;
  act: (e: Entry, action: "accept" | "reject" | "approve_event", detail?: string, ttlDays?: number) => void;
  setSummaryEntry: (e: Entry) => void;
  staleSinceOf: (e: Entry) => string | null;
  peersOf: (e: Entry) => PeerScore[];
  peerFactsOf: (e: Entry) => JobPeerContext | null;
}) {
  const t = useTranslations("decisions");
  if (visibleAiReviews.length === 0) return null;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <Sparkles size={13} className="text-coral" /> {t("aiRecommendations")} <span className="text-coral">· {visibleAiReviews.length}</span>
        </h3>
        {/* Direction 1 — batch accept/reject. Offered when 2+ cards are
            batchable (offer_review excluded); a single card is faster one-by-one.
            Once armed, the toggle stays so the recruiter can always exit. */}
        {selectMode || selectableReviews.length > 1 ? (
          <button
            type="button"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            aria-pressed={selectMode}
            className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold ${
              selectMode ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel hover:bg-stone-50"
            }`}
          >
            <ListChecks size={13} /> {selectMode ? t("batch.exit") : t("batch.select")}
          </button>
        ) : null}
      </div>

      {selectMode ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-coral/30 bg-coral/5 px-3 py-2">
          <span className="text-sm font-semibold text-ink" aria-live="polite">
            {t("batch.selectedCount", { count: selectedReviews.length })}
          </span>
          <button
            type="button"
            onClick={selectAllReviews}
            className="focus-ring rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
          >
            {t("batch.selectAll", { count: selectableReviews.length })}
          </button>
          {selectedReviews.length > 0 ? (
            <button
              type="button"
              onClick={clearSelectedReviews}
              className="focus-ring rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
            >
              {t("batch.clear")}
            </button>
          ) : null}
          {/* Direction 3 — select-all drift cue: cards arrived since the
              recruiter selected all, so the current select-all is stale.
              Clicking re-selects (and re-snapshots) the current cohort. */}
          {selectionDrift > 0 ? (
            <button
              type="button"
              onClick={selectAllReviews}
              aria-live="polite"
              className="focus-ring inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
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
              <button
                type="button"
                onClick={() => void bulkDecideReviews("accept")}
                disabled={bulkBusy}
                className="focus-ring rounded-md bg-moss px-3 py-1 text-sm font-semibold text-white hover:bg-moss/90 disabled:opacity-50"
              >
                {t("batch.accept", { count: selectedReviews.length })}
              </button>
              {confirmingBulkReject ? (
                <>
                  <span className="text-sm font-semibold text-coral">{t("batch.rejectConfirm", { count: selectedReviews.length })}</span>
                  <button
                    type="button"
                    onClick={() => void bulkDecideReviews("reject")}
                    disabled={bulkBusy}
                    className="focus-ring rounded-md bg-coral px-3 py-1 text-sm font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
                  >
                    {bulkBusy ? t("batch.rejecting") : t("batch.rejectConfirmYes")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingBulkReject(false)}
                    disabled={bulkBusy}
                    className="focus-ring rounded-md px-2 py-1 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
                  >
                    {t("batch.rejectCancel")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingBulkReject(true)}
                  disabled={bulkBusy}
                  className="focus-ring rounded-md border border-coral/40 bg-white px-3 py-1 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
                >
                  {t("batch.reject", { count: selectedReviews.length })}
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibleAiReviews.map((e) => {
          const eligible = e.approvalKind !== "offer_review";
          return (
            <div key={e.id} data-sim-entry={e.id} className={leavingWrapClass(e)}>
              <AiReviewCard
                entry={e}
                onAccept={(ttlDays) => act(e, "accept", undefined, ttlDays)}
                onReject={() => act(e, "reject")}
                selectMode={selectMode}
                selected={selectedReviewIds.has(e.id)}
                onToggleSelect={eligible ? () => toggleReviewSelect(e) : undefined}
                onInspect={() => setSummaryEntry(e)}
                staleSince={staleSinceOf(e)}
                peers={peersOf(e)}
                peerFacts={peerFactsOf(e)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
