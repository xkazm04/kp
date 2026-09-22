"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { PipelineBoardPanel } from "./PipelineBoardPanel";
import { AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { PipelineEmptyState } from "./empty/PipelineEmptyState";
import { useSetupUnfinished } from "@/app/features/shell/setup/useSetupUnfinished";
import { requestOnboardingReopen } from "@/app/features/shell/setup/onboardingReopen";
import { Defer } from "@/app/_components/ui/Defer";
import { SECTION } from "@/app/_components/ui/recipes";
import { useEventVerb, useRelativeTime } from "./PipelineShared";
import { TodayRail } from "./PipelineTodayRail";
import { usePipelineTabState } from "./usePipelineTabState";
import { PipelineActivityFeed } from "./PipelineActivityFeed";
import { PipelineAttentionStrip } from "./PipelineAttentionStrip";
import { PipelineStatHeader } from "./PipelineStatHeader";
import { PipelineFilterBar } from "./PipelineFilterBar";
import { PipelinePopulatedBoard } from "./PipelinePopulatedBoard";
import { Fade } from "./PipelineMotion";
import { resolveStageFilter } from "./usePipelineFilters";

// Tier 3 (docs/design/loading-choreography.md): the candidate modal is a large
// subtree (scorecard, interview transcript, consent panel, GitHub evidence,
// token-link management…) that most board views never open — it's reachable
// only by clicking a candidate. Code-split it out of the tab's entry chunk so a
// bare pipeline visit never pays for it; the loading gap is the modal's own scrim,
// so a slow chunk load doesn't flash a mismatched placeholder. It mounts
// conditionally on `candidate`, so no <Defer> is needed on top — that primitive is
// for tab-load ordering, not a click-triggered open.
const CandidateModal = dynamic(() => import("./candidate/CandidateModal").then((m) => ({ default: m.CandidateModal })), {
  loading: () => <div className="reveal-quiet fixed inset-0 z-50 bg-scrim" aria-hidden />,
});

export function PipelineTab() {
  const s = usePipelineTabState();
  const enumLabel = useEnumLabel();
  const eventVerb = useEventVerb();
  const relativeTime = useRelativeTime();
  // The setup wizard has no other door since the Getting-started checklist was
  // deleted: the empty board offers it as step zero when setup is unfinished.
  const setupUnfinished = useSetupUnfinished();
  // The board section on the full page (the filter bar's second-row toggle).
  const [boardExpanded, setBoardExpanded] = useState(false);
  const collapseBoard = useCallback(() => setBoardExpanded(false), []);

  return (
    <div className={`stagger-children ${SECTION}`} aria-busy={s.entries == null}>
      <PipelineStatHeader
        t={s.t}
        entries={s.entries}
        positions={s.positions}
        activeCount={s.activeCount}
        interviewCount={s.interviewCount}
        staleCount={s.staleCount}
        degradedCount={s.degradedCount}
        approvals={s.approvals}
        onToggleAging={() => s.toggleQuick("aging")}
        onToggleActive={() => s.toggleQuick("active")}
        onToggleInterview={() => s.toggleQuick("interview")}
        activeSelected={s.quicks.has("active")}
        interviewSelected={s.quicks.has("interview")}
        onFocusDegraded={s.focusDegradedCohort}
        onGoToDecisions={s.goToDecisions}
      />

      {/* Command line, AI screen, automation pass and the scheduler moved to the
          bottom Control Center (app/features/shell/simulation/SimControlDock.tsx) — they're
          workspace-level automation, so the pipeline page stays focused on the
          board and the day's work, not the machinery. */}

      {/* The two queues that outrank everything below them, consolidated into one
          ranked strip: a stalled application or a decision waiting on you is
          today's work. Self-hiding when both are empty. */}
      <PipelineAttentionStrip
        t={s.t}
        degradedCount={s.degradedCount}
        approvalsCount={s.approvals.length}
        onReviewDegraded={s.focusDegradedCohort}
        onOpenDecisions={s.goToDecisions}
      />

      {/* 8f8f578d — candidate-driven work narrated with names + destinations,
          on the landing surface (badges only carry counts). The rail's inbound /
          offers-out / hired buckets are stage ROLE questions, so it gets the same
          resolved axis the board and the drawer read (UAT KAT-L1-002). */}
      {s.entries && s.entries.length > 0 ? (
        <TodayRail entries={s.entries} axis={s.axis} onShowStage={s.showStage} />
      ) : null}

      {/* Fades in and out rather than blinking the whole column up by a row. */}
      <Fade show={Boolean(s.moveError)}>
        <p role="alert" className="flex items-center justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-base text-red-700">
          <span>{s.moveError}</span>
          <button
            type="button"
            onClick={s.dismissMoveError}
            aria-label={s.t("moveErrorDismiss")}
            className="focus-ring shrink-0 rounded p-0.5 transition-opacity hover:opacity-70"
          >
            <X size={15} aria-hidden />
          </button>
        </p>
      </Fade>

      {s.error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">{s.error}</p>
      ) : s.entries != null && s.entries.length === 0 ? (
        /* The empty board is the first-run moment, so it carries the three
           moves in the order the product actually enforces - a role first,
           candidates onto it, channels as the next choice - and, when the
           operator left the setup wizard early, the door back to it. The board's
           own lanes are the illustration and each move is one action card
           (empty/PipelineEmptyState.tsx). */
        <PipelineEmptyState
          axis={s.axis}
          setupUnfinished={setupUnfinished}
          onResumeSetup={requestOnboardingReopen}
          onStartTour={s.sim.running ? undefined : s.sim.start}
        />
      ) : (
        /* ONE panel: the filter header and the lanes it filters are the same
           object. The header used to float several blocks above the board with
           the banners, bulk bar and saved views wedged between them. */
        <PipelineBoardPanel expanded={boardExpanded} onCollapse={collapseBoard} label={s.t("boardFullPageAria")}>
          {/* Tier 1 chrome: the search box, quick-filter chips, score/source facets
              and sort control depend on nothing but client state — they render on
              the first frame like any other filter bar, not behind the board fetch. */}
          <PipelineFilterBar
            t={s.t}
            enumLabel={enumLabel}
            query={s.query}
            onQueryChange={s.setQueryAndSync}
            quicks={s.quicks}
            onToggleQuick={s.toggleQuick}
            stageFilter={s.stageFilter}
            /* UAT TOM-ANA-11 — resolve the deep-linked stage against the columns this
               WORKSPACE actually renders (Settings → Hiring composes them), not the
               shipped five. The axis rides in with the board payload, so it is only
               trustworthy once entries have landed; until then the bar is told
               "not known yet" (null) and shows no notice it might have to retract. */
            stageResolved={
              s.stageFilter && s.entries != null
                ? resolveStageFilter(s.stageFilter, s.axis, s.retiredStages)
                : null
            }
            onClearStage={s.clearStageFilter}
            filtering={s.filtering}
            shownCount={s.filteredEntries.length}
            totalCount={(s.entries ?? []).length}
            activeViewId={s.activeViewId}
            onSaveView={s.openSaveView}
            selectMode={s.selectMode}
            onToggleSelectMode={s.toggleSelectMode}
            editingSla={s.editingSla}
            onToggleSlaEditor={() => s.setEditingSla((v) => !v)}
            scoreBands={s.scoreBands}
            onToggleBand={s.toggleBand}
            scoreBandKeys={s.SCORE_BANDS}
            sourceValues={s.sourceValues}
            sources={s.sources}
            onToggleSource={s.toggleSource}
            channelName={s.channelName}
            sort={s.sort}
            onSortChange={s.setSortAndSync}
            onClearFilters={s.clearFilters}
            expanded={boardExpanded}
            onToggleExpanded={() => setBoardExpanded((v) => !v)}
          />
          {s.entries == null ? (
            /* Tier 2: the board fetch is in flight and there is nothing to show yet.
               Hold roughly the board's height so the page doesn't jump when it lands,
               and stay invisible for 150ms so a warm response paints nothing at all.
               (Was a bare "Loading…" line — docs/design/loading-choreography.md law 4.) */
            <div className="reveal-quiet min-h-[28rem]" aria-hidden />
          ) : (
            <PipelinePopulatedBoard s={s} enumLabel={enumLabel} />
          )}
        </PipelineBoardPanel>
      )}

      {/* Tier 3 — the activity feed is history, not the day's work: it reads only
          after the board has been triaged, and most sessions never scroll to it.
          Deferring until it nears the viewport keeps its list off the first commit
          so the lanes paint sooner on a cold tab render. */}
      {s.error ? null : (
        <Defer strategy="visible" placeholder={<div className="reveal-quiet min-h-[12rem]" aria-hidden />}>
          <PipelineActivityFeed
            t={s.t}
            eventsError={s.eventsError}
            events={s.events}
            eventVerb={eventVerb}
            relativeTime={relativeTime}
            onOpenEntry={s.openEntryById}
          />
        </Defer>
      )}

      <AnimatePresence>
        {s.candidate ? (
          // The modal keys its BODY by entry id (per-entry result/notes/busy/token-link
          // state resets on a step) and keeps its frame, so a step does not re-animate.
          <CandidateModal
            key="candidate-modal"
            view={s.candidate}
            boardCohort={s.cohortOrder}
            // UAT KAT-L1-002 — the resolved axis, so "is this candidate hired?" is a
            // stage ROLE and never the literal name "Hired".
            axis={s.axis}
            onClose={s.closeCandidate}
            onChanged={s.load}
            onOpenEntry={s.openEntryById}
            onOpenProfile={s.openProfile}
            onNavigate={s.showCandidate}
            onTab={s.setCandidateTab}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
