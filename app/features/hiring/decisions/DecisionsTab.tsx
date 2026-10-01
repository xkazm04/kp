"use client";

// The Decisions tab shell: header + filters, the status banners, the
// AI-review and key-decisions sections, the reconsider queue, and the modal
// wiring. All state/mutation logic lives in useDecisionsQueue.ts; the header,
// banners, AI-review batch section and reconsider queue render via their own
// split-out components — kept that way so this shell stays under the
// 200-line cap (docs/architecture/app-structure.md).
import { useState } from "react";
import { DocketSurface } from "./docket/DocketSurface";
import { DecisionsBanners } from "./DecisionsBanners";
import { DecisionsReconsiderQueue } from "./DecisionsReconsiderQueue";
import { DecisionsFeedbackLetters } from "./DecisionsFeedbackLetters";
import { DecisionsModals } from "./DecisionsModals";
import { useDecisionsQueue } from "./useDecisionsQueue";
import { useDecisionsCandidate } from "./useDecisionsCandidate";
import { CandidateModal } from "../pipeline/candidate/CandidateModal";
import { AnimatePresence } from "framer-motion";

export function DecisionsTab() {
  const [rulesOpen, setRulesOpen] = useState(false);
  const {
    setJobFilter, armIds, armJobId, entries, error, axis,
    leavingWrapClass, queuedLabels, setQueuedLabels,
    sentOffers, setSentOffers, copiedOfferId, setCopiedOfferId, relayConfigured,
    waveCommsFailed, setWaveCommsFailed,
    waveSealFailed, setWaveSealFailed,
    summaryEntry, setSummaryEntry, waveRole, setWaveRole,
    evalMode, setEvalMode, groupEval,
    evaluated, reconsider, reinstating, reinstate, reinstateErrors,
    reconsiderOpen, setReconsiderOpen, reconsiderRef, revealReconsider,
    fmtDate, reconsiderReasonText,
    pending, jobOptions, activeFilter,
    visibleAiReviews, selectableReviews, hasOfferReviews, selectedReviews,
    selectionDrift, selectMode, setSelectMode, selectedReviewIds,
    toggleReviewSelect, exitSelectMode, selectAllReviews, clearSelectedReviews,
    bulkBusy, bulkResult, confirmingBulkReject, setConfirmingBulkReject, bulkDecideReviews,
    visibleGroups, act, decide, staleSinceOf,
    peersOf, peerFactsOf, load,
  } = useDecisionsQueue();
  // The candidate modal a ledger row's Decide opens — the board's own modal, with
  // the recommendation and the ladder attached.
  const candidate = useDecisionsCandidate({ visibleAiReviews, act, staleSinceOf, peersOf, peerFactsOf });

  const pendingHeaderCount = activeFilter
    ? visibleAiReviews.length + visibleGroups.reduce((n, g) => n + g.entries.length, 0)
    : pending.length;

  return (
    // Tier 1 (docs/design/loading-choreography.md): the header, filters and queue
    // chrome below are direct children of this stagger-children container so
    // they cascade in on the first frame regardless of whether the fetch has
    // resolved. aria-busy covers the FIRST load only — useLiveRefresh re-fetches
    // never blank the queue already on screen, so entries != null keeps it false.
    <div data-sim="decisions" className="stagger-children space-y-6" aria-busy={entries == null && !error}>
      <DecisionsBanners
        queuedLabels={queuedLabels}
        onDismissQueued={() => setQueuedLabels([])}
        sentOffers={sentOffers}
        relayConfigured={relayConfigured}
        copiedOfferId={copiedOfferId}
        onCopyOffer={(id, link) => {
          void navigator.clipboard?.writeText(link);
          setCopiedOfferId(id);
        }}
        onDismissSentOffers={() => setSentOffers([])}
        waveCommsFailed={waveCommsFailed}
        onDismissWaveComms={() => setWaveCommsFailed([])}
        waveSealFailed={waveSealFailed}
        onDismissWaveSeal={() => setWaveSealFailed(0)}
      />

      <DocketSurface
        entries={entries}
        error={error}
        pending={pending}
        pendingHeaderCount={pendingHeaderCount}
        visibleAiReviews={visibleAiReviews}
        visibleGroups={visibleGroups}
        jobOptions={jobOptions}
        activeFilter={activeFilter}
        setJobFilter={setJobFilter}
        evalMode={evalMode}
        setEvalMode={setEvalMode}
        reconsiderCount={reconsider.length}
        onRevealReconsider={revealReconsider}
        onOpenRules={() => setRulesOpen(true)}
        selectMode={selectMode}
        setSelectMode={setSelectMode}
        exitSelectMode={exitSelectMode}
        selectableReviews={selectableReviews}
        selectedReviews={selectedReviews}
        selectedReviewIds={selectedReviewIds}
        toggleReviewSelect={toggleReviewSelect}
        selectAllReviews={selectAllReviews}
        clearSelectedReviews={clearSelectedReviews}
        selectionDrift={selectionDrift}
        hasOfferReviews={hasOfferReviews}
        bulkResult={bulkResult}
        confirmingBulkReject={confirmingBulkReject}
        setConfirmingBulkReject={setConfirmingBulkReject}
        bulkBusy={bulkBusy}
        bulkDecideReviews={bulkDecideReviews}
        leavingWrapClass={leavingWrapClass}
        act={act}
        staleSinceOf={staleSinceOf}
        onDecide={candidate.open}
        evaluated={evaluated}
        isBusy={groupEval.isBusy}
        onCandidate={setSummaryEntry}
        onGroupEval={(g, selection) => groupEval.open(g, false, selection)}
        onScreenWave={(jobId, title) => setWaveRole({ jobId, title })}
        armIds={armIds}
        armJobId={armJobId}
        recordCount={entries?.length ?? 0}
        onArrivalLanded={load}
        extras={
          <>
            <DecisionsReconsiderQueue
              reconsider={reconsider}
              reconsiderRef={reconsiderRef}
              reconsiderOpen={reconsiderOpen}
              setReconsiderOpen={setReconsiderOpen}
              reinstating={reinstating}
              reinstate={reinstate}
              reinstateErrors={reinstateErrors}
              fmtDate={fmtDate}
              reconsiderReasonText={reconsiderReasonText}
            />
            {/* Spark interview-feedback-letter: decided candidates who asked for a letter about their
                AI interview. Self-contained (its own read and editor). */}
            <DecisionsFeedbackLetters />
          </>
        }
      />

      <AnimatePresence>
        {candidate.view ? (
          <CandidateModal
            key="decisions-candidate"
            view={candidate.view}
            boardCohort={candidate.cohort}
            axis={axis}
            onClose={candidate.close}
            onChanged={() => void load()}
            onOpenEntry={candidate.openById}
            onNavigate={candidate.navigate}
            onTab={candidate.setTab}
            decision={candidate.decision}
          />
        ) : null}
      </AnimatePresence>

      <DecisionsModals
        summaryEntry={summaryEntry}
        setSummaryEntry={setSummaryEntry}
        decide={decide}
        groupEval={groupEval}
        act={act}
        rulesOpen={rulesOpen}
        setRulesOpen={setRulesOpen}
        waveRole={waveRole}
        setWaveRole={setWaveRole}
        load={load}
        setWaveCommsFailed={setWaveCommsFailed}
        setWaveSealFailed={setWaveSealFailed}
      />
    </div>
  );
}
