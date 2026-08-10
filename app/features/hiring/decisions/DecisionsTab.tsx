"use client";

// The Decisions tab shell: header + filters, the status banners, the
// AI-review and key-decisions sections, the reconsider queue, and the modal
// wiring. All state/mutation logic lives in useDecisionsQueue.ts; the header,
// banners, AI-review batch section and reconsider queue render via their own
// split-out components — kept that way so this shell stays under the
// 200-line cap (docs/architecture/app-structure.md).
import { useState } from "react";
import { DecisionsEmptyHandoff } from "./DecisionsEmptyHandoff";
import { Empty } from "./DecisionsShared";
import { RoleDecisionRow } from "./DecisionsRoleRow";
import { DecisionsHeader } from "./DecisionsHeader";
import { DecisionsBanners } from "./DecisionsBanners";
import { DecisionsAiReviewsSection } from "./DecisionsAiReviewsSection";
import { DecisionsReconsiderQueue } from "./DecisionsReconsiderQueue";
import { DecisionsModals } from "./DecisionsModals";
import { useDecisionsQueue } from "./useDecisionsQueue";

export function DecisionsTab() {
  const [rulesOpen, setRulesOpen] = useState(false);
  const {
    t, setJobFilter, armIds, armJobId, entries, error,
    leavingWrapClass, queuedLabels, setQueuedLabels,
    sentOffers, setSentOffers, copiedOfferId, setCopiedOfferId, relayConfigured,
    waveCommsFailed, setWaveCommsFailed,
    summaryEntry, setSummaryEntry, waveRole, setWaveRole,
    evalRole, setEvalRole, evalMode, setEvalMode, evalData, setEvalData,
    evalCreatedAt, setEvalCreatedAt, evalTaskId, setEvalTaskId, evalError, setEvalError,
    evaluated, reconsider, reinstating, reinstate,
    reconsiderOpen, setReconsiderOpen, reconsiderRef, revealReconsider,
    fmtDate, reconsiderReasonText,
    pending, jobOptions, activeFilter,
    visibleAiReviews, selectableReviews, hasOfferReviews, selectedReviews,
    selectionDrift, selectMode, setSelectMode, selectedReviewIds,
    toggleReviewSelect, exitSelectMode, selectAllReviews, clearSelectedReviews,
    bulkBusy, bulkResult, confirmingBulkReject, setConfirmingBulkReject, bulkDecideReviews,
    visibleGroups, act, openGroupEval, decide, evalGroup, evalDrift, staleSinceOf,
    peersOf, peerFactsOf, load,
  } = useDecisionsQueue();

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
      <DecisionsHeader
        jobOptions={jobOptions}
        activeFilter={activeFilter}
        pending={pending}
        setJobFilter={setJobFilter}
        evalMode={evalMode}
        setEvalMode={setEvalMode}
        reconsiderCount={reconsider.length}
        onRevealReconsider={revealReconsider}
        onOpenRules={() => setRulesOpen(true)}
        pendingHeaderCount={pendingHeaderCount}
      />

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
      />

      {error ? (
        <p role="alert" aria-live="assertive" className="rounded-md bg-red-50 p-3 text-base text-red-700">
          {error}
        </p>
      ) : entries == null ? (
        // Tier 2: the pipeline fetch is in flight and there's nothing to show
        // yet. Hold the queue's rough height and stay invisible for 150ms so a
        // warm response never flashes a placeholder.
        <div className="reveal-quiet min-h-[24rem]" aria-hidden />
      ) : pending.length === 0 ? (
        <DecisionsEmptyHandoff
          title={t("caughtUpTitle")}
          body={t("caughtUpBody")}
          links={[
            { tab: "schedule", label: t("caughtUpCtaSchedule") },
            { tab: "pipeline", label: t("caughtUpCtaPipeline") },
          ]}
          recordCount={entries.length}
          reconsiderCount={reconsider.length}
        />
      ) : (
        <div className="space-y-6">
          <DecisionsAiReviewsSection
            visibleAiReviews={visibleAiReviews}
            selectMode={selectMode}
            setSelectMode={setSelectMode}
            selectableReviews={selectableReviews}
            selectedReviewIds={selectedReviewIds}
            selectedReviews={selectedReviews}
            toggleReviewSelect={toggleReviewSelect}
            exitSelectMode={exitSelectMode}
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
            setSummaryEntry={setSummaryEntry}
            staleSinceOf={staleSinceOf}
            peersOf={peersOf}
            peerFactsOf={peerFactsOf}
          />

          <section>
            <h3 className="text-meta uppercase tracking-wide text-steel">
              {t("keyDecisions")} <span className="text-coral">· {visibleGroups.length}</span>
            </h3>
            <p className="mt-1 text-sm text-steel">{t("keyDecisionsHelp")}</p>
            <div className="mt-3 space-y-3">
              {visibleGroups.map((g) => (
                <RoleDecisionRow
                  key={g.roleKey}
                  roleTitle={g.roleTitle}
                  entries={g.entries}
                  evaluated={Boolean(evaluated[g.roleKey])}
                  busy={evalTaskId !== null && evalRole?.roleKey === g.roleKey}
                  onCandidate={setSummaryEntry}
                  onGroupEval={(selection) => openGroupEval(g, false, selection)}
                  onScreenWave={g.jobId ? () => setWaveRole({ jobId: g.jobId as string, title: g.roleTitle }) : undefined}
                  // The pre-armed selection lands only on the deep-linked role's row;
                  // the row consumes it once at mount (a later remount re-seeds from
                  // the same session-captured intent, never from the stripped URL).
                  initialSelection={armIds && armJobId && g.jobId === armJobId ? armIds : undefined}
                />
              ))}
              {visibleGroups.length === 0 ? <Empty>{t("noKeyDecisions")}</Empty> : null}
            </div>
          </section>
        </div>
      )}

      <DecisionsReconsiderQueue
        reconsider={reconsider}
        reconsiderRef={reconsiderRef}
        reconsiderOpen={reconsiderOpen}
        setReconsiderOpen={setReconsiderOpen}
        reinstating={reinstating}
        reinstate={reinstate}
        fmtDate={fmtDate}
        reconsiderReasonText={reconsiderReasonText}
      />

      <DecisionsModals
        summaryEntry={summaryEntry}
        setSummaryEntry={setSummaryEntry}
        decide={decide}
        evalRole={evalRole}
        setEvalRole={setEvalRole}
        evalData={evalData}
        setEvalData={setEvalData}
        evalCreatedAt={evalCreatedAt}
        setEvalCreatedAt={setEvalCreatedAt}
        evalTaskId={evalTaskId}
        setEvalTaskId={setEvalTaskId}
        evalError={evalError}
        setEvalError={setEvalError}
        evalGroup={evalGroup}
        evalDrift={evalDrift}
        openGroupEval={openGroupEval}
        act={act}
        rulesOpen={rulesOpen}
        setRulesOpen={setRulesOpen}
        waveRole={waveRole}
        setWaveRole={setWaveRole}
        load={load}
        setWaveCommsFailed={setWaveCommsFailed}
      />
    </div>
  );
}
