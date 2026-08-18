"use client";

import dynamic from "next/dynamic";
import { Play, X } from "lucide-react";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { PipelineEmptyFirstCandidate } from "./PipelineEmptyFirstCandidate";
import { GettingStartedCard } from "@/app/features/shell/setup/GettingStartedCard";
import { Defer } from "@/app/_components/ui/Defer";
import { PANEL, SECTION } from "@/app/_components/ui/recipes";
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

// Tier 3 (docs/design/loading-choreography.md): the candidate drawer is a 1300+ line
// subtree (scorecards, interview transcript, consent panel, GitHub evidence,
// token-link management…) that most board views never open — it's reachable
// only by clicking a card. Code-split it out of the tab's entry chunk so a
// bare pipeline visit never pays for it; the loading gap mirrors the drawer's
// own shape (a right-side panel) so a slow chunk load doesn't flash a
// mismatched placeholder. It already mounts conditionally on drawerEntry, so
// no <Defer> is needed on top — that primitive is for tab-load ordering, not
// a click-triggered open.
const CandidateDrawer = dynamic(() => import("./PipelineCandidateDrawer").then((m) => ({ default: m.CandidateDrawer })), {
  loading: () => (
    <div className="fixed inset-0 z-50 flex justify-end" aria-hidden>
      <div className="reveal-quiet h-full w-full max-w-md border-l border-stone-200 bg-paper shadow-overlay" />
    </div>
  ),
});

export function PipelineTab() {
  const s = usePipelineTabState();
  const enumLabel = useEnumLabel();
  const eventVerb = useEventVerb();
  const relativeTime = useRelativeTime();

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
        onFocusDegraded={s.focusDegradedCohort}
        onGoToDecisions={s.goToDecisions}
      />

      {/* Command line, AI screen, automation pass and the scheduler moved to the
          bottom Control Center (app/features/shell/simulation/SimControlDock.tsx) — they're
          workspace-level automation, so the pipeline page stays focused on the
          board and the day's work, not the machinery. */}

      {/* The two queues that outrank everything below them, consolidated into one
          ranked strip and hoisted ABOVE the setup checklist: a stalled application
          or a decision waiting on you is today's work, the checklist is onboarding.
          Self-hiding when both are empty. */}
      <PipelineAttentionStrip
        t={s.t}
        degradedCount={s.degradedCount}
        approvalsCount={s.approvals.length}
        onReviewDegraded={s.focusDegradedCohort}
        onOpenDecisions={s.goToDecisions}
      />

      {/* First-run hand-off: the wizard's Getting-started checklist lives on the
          default tab. Data-derived + self-hiding (dismiss / all steps done), so
          established workspaces see it once at most. */}
      <GettingStartedCard />

      {/* 8f8f578d — candidate-driven work narrated with names + destinations,
          on the landing surface (badges only carry counts). */}
      {s.entries && s.entries.length > 0 ? <TodayRail entries={s.entries} onShowStage={s.showStage} /> : null}

      {/* Fades in and out rather than blinking the whole column up by a row. */}
      <Fade show={Boolean(s.moveError)}>
        <p role="alert" className="flex items-center justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-base text-red-700">
          <span>{s.moveError}</span>
          <button
            type="button"
            onClick={() => s.setMoveError(null)}
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
        /* The empty board rehearses the real stage lanes with a slot waiting in
           Accepted, so a first-run recruiter sees the funnel's shape, not a hole.
           It owns the whole surface — no filter header above a board that has
           nothing to filter. */
        <PipelineEmptyFirstCandidate
          title={s.t("emptyTitle")}
          body={s.t("emptyBody")}
          links={[
            { tab: "channels", label: s.t("emptyCtaChannels") },
            { tab: "archetypes", label: s.t("emptyCtaProfile") },
          ]}
          // 5d2e0998 — the empty board is the first-run moment: offer the
          // guided tour (the simulation walks the whole hiring story live).
          extraAction={
            !s.sim.running ? (
              <button
                type="button"
                onClick={s.sim.start}
                className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
              >
                <Play size={13} aria-hidden /> {s.t("emptyCtaTour")}
              </button>
            ) : undefined
          }
        />
      ) : (
        /* ONE panel: the filter header and the lanes it filters are the same
           object. The header used to float several blocks above the board with
           the banners, bulk bar and saved views wedged between them. */
        <section className={`${PANEL} overflow-hidden`}>
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
        </section>
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
          />
        </Defer>
      )}

      {s.drawerEntry ? (
        // key on the entry id so switching candidates remounts the drawer, resetting
        // its per-entry result/notes/busy/token-link state instead of briefly showing
        // the previous candidate's.
        <CandidateDrawer
          key={s.drawerEntry.id}
          entry={s.drawerEntry}
          onClose={() => s.setDrawerEntry(null)}
          onChanged={s.load}
          onOpenEntry={s.openEntryById}
          cohort={s.cohortOrder}
          onNavigate={s.setDrawerEntry}
          // UAT KAT-L1-002 — the resolved axis the board is already holding, so the
          // drawer reads "is this candidate hired?" as a stage ROLE and not as the
          // literal name "Hired".
          axis={s.axis}
        />
      ) : null}
    </div>
  );
}
