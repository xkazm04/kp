"use client";

// All of PipelineTab's state, effects and handlers (board load/poll, compound
// filters + URL sync, saved views, bulk select/move/decide/invite/outreach, drag
// move, and the drawer/profile/job navigation helpers). Split out of the .tsx so
// the component file is just wiring + markup; this hook owns no JSX.
//
// Each of those concerns now lives in its own hook (usePipelineSla,
// usePipelineBoardData, usePipelineFilters, usePipelineSavedViews, usePipelineBulk,
// usePipelineNavigation); what is left here is the composition — the tab-level
// derivations that read across two concerns (the stat counts, the filtered board,
// the drawer cohort) and the ONE flat object PipelineTab and its children destructure.
//
// The call order below is load-bearing: effects run in hook-call order, so the hooks
// are composed in the same sequence their effects were registered when this was one
// body (SLA hydration → board load/poll → URL-sync teardown → view hydration → the
// outreach-completion watcher → the batch-screen reload).

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSimulation } from "@/app/features/shell/simulation/SimulationProvider";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import {
  SCORE_BANDS,
  entryMatchesFilters,
  entrySource,
  sortFilteredEntries,
  UNATTRIBUTED_SOURCE,
  type QuickFilter,
} from "./pipelineBoardFilters";
import { boardVisibleOrder, groupPositions } from "./pipelineBoardLayout";
import { stageHasRole, stagesWithRole } from "@/app/_lib/pipeline-stages";
import { daysSince, slaForStage, type Entry } from "@/app/features/shared/pipelineTypes";
import { boardPopulation } from "./pipelineBoardPopulation";
import { usePipelineSla } from "./usePipelineSla";
import { usePipelineBoardData } from "./usePipelineBoardData";
import { usePipelineFilters, emptyFacets } from "./usePipelineFilters";
import { usePipelineSavedViews } from "./usePipelineSavedViews";
import { usePipelineBulk } from "./usePipelineBulk";
import { usePipelineNavigation } from "./usePipelineNavigation";

export function usePipelineTabState() {
  const t = useTranslations("pipeline.tab");
  // Source-facet chip labels reuse the channel-name catalog Analytics maintains
  // (mirrors the drawer's origin chip), falling back to the raw id for unmapped
  // values; the null-source sentinel gets its own localized "unattributed" label.
  const tChannels = useTranslations("analytics.channels");
  const channelName = (channel: string) => {
    if (channel === UNATTRIBUTED_SOURCE) return t("filterSourceUnattributed");
    const key = `names.${channel}` as Parameters<typeof tChannels>[0];
    return tChannels.has(key) ? tChannels(key) : channel;
  };
  // REC-10 — "invited to schedule" only reads as delivered when a relay exists;
  // without one the bulk invites are terminal outbox rows.
  const relayConfigured = useDeliveryCapability();
  const [drawerEntry, setDrawerEntry] = useState<Entry | null>(null);

  const { slaOverrides, setStageSla, editingSla, setEditingSla } = usePipelineSla();
  const { tasks } = useTasks();
  // 5d2e0998 — the empty board offers the guided tour (simulation start).
  const sim = useSimulation();
  const lastBatchDone = useRef<string | null>(null);

  // The board's data plane: entries/events/error + the self-sequencing load(), its
  // 30s poll (paused while the drawer is open), and the optimistic drag move.
  const board = usePipelineBoardData({
    t,
    slaOverrides,
    drawerOpen: drawerEntry != null,
  });
  const { entries, events, error, eventsError, load, moveError, moveErrorEntryId, dismissMoveError, moveEntry } = board;
  // The compound filters + their two-way URL sync, and the visible-scope signature
  // the bulk confirms are stamped with.
  const filters = usePipelineFilters();
  const { query, quicks, scoreBands, sources, sort, stageFilter, filtering, visibleScope } = filters;
  // Saved views read and write the filter state through the handle above.
  const savedViews = usePipelineSavedViews({ filters });

  const positions = useMemo(() => groupPositions(entries ?? []), [entries]);

  const approvals = (entries ?? []).filter((e) => needsHumanDecision(e.approvalKind) && e.status === "active");
  // The stat chips and the aging verdict ask what a stage MEANS, so they read its
  // ROLE off the workspace's resolved axis rather than its name (pipeline-stages.ts).
  // The axis is workspace-editable: a board that adds a second interview column
  // ("Onsite") under-counted "in interview" by exactly the candidates standing in it,
  // and a board whose terminal column is not literally called "Hired" counted its
  // hired candidates as active AND aged them (slaForStage falls back to STALE_DAYS for
  // an unknown stage, so every hired card older than 10 days went amber). An off-axis
  // id resolves to no role — so a stranded candidate reads as neither terminal nor
  // interview, which is the honest answer. Byte-identical on the shipped axis.
  const interviewStages = stagesWithRole("interview", board.axis);
  const isTerminal = (e: Entry) => stageHasRole(e.stage, "terminal", board.axis);
  // WHO the chips count is the ONE population predicate the Today rail names from
  // (pipelineBoardPopulation.ts): real (non-sim) rows, live status. These three
  // counters used to run over EVERY row — the guided demo's own `(SIM)` artifacts,
  // and every rejected or withdrawn candidate still parked on a live column, because
  // nothing moves a rejected card off its stage. So the header read "Active 14" over
  // a rail that named four people, and the aging chip aged rows the funnel had
  // already written off. `approvals` and `degraded` below deliberately keep their
  // own predicates: an approval is real work waiting on the Decisions gate whoever
  // created it, and a degraded stub is a recoverability signal, not a funnel count.
  const population = boardPopulation(entries);
  const activeCount = population.active.filter((e) => !isTerminal(e)).length;
  const interviewCount = population.active.filter((e) => interviewStages.includes(e.stage)).length;
  // The threshold resolves by ROLE on the same axis (pipelineTypes.slaForStage): a
  // workspace's own "Tech round" ages like an interview, not on the flat legacy cut.
  const isStale = (e: Entry) =>
    !isTerminal(e) && (daysSince(e.stageChangedAt) ?? 0) >= slaForStage(e.stage, slaOverrides, board.axis);
  const staleCount = population.active.filter(isStale).length;
  // Stubs from a failed intake normalization: visible, recoverable, and not yet
  // matchable until a recruiter captures the profile. Active-only — a rejected
  // stub is out of the funnel and doesn't need recovery.
  const degraded = (entries ?? []).filter((e) => e.intakeDegraded && e.status !== "rejected");
  const degradedCount = degraded.length;

  // Board search + compound filters (PIPE2 / perfect-board). The summary StatChips
  // above stay full totals; only the board (its lanes + cards) narrows. The composed
  // predicate lives in the pure filters module; the chosen sort is applied WITHIN the
  // filtered set (lanes group downstream, so this reorders cards within each cell).
  // boardPositions drops lanes with no surviving candidate so a filter doesn't leave
  // empty columns.
  const filteredEntries = useMemo(() => {
    const matched = (entries ?? []).filter((e) =>
      entryMatchesFilters(e, { query, quicks, scoreBands, sources, stage: stageFilter }, { overrides: slaOverrides, axis: board.axis })
    );
    return sortFilteredEntries(matched, sort);
  }, [entries, query, quicks, scoreBands, sources, stageFilter, slaOverrides, sort, board.axis]);

  // The distinct source/channel facet values present on the board (all entries, not
  // the filtered set), so the source chips only offer values that actually exist —
  // including the unattributed sentinel when any entry has no channel.
  const sourceValues = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries ?? []) s.add(entrySource(e));
    return [...s].sort();
  }, [entries]);

  const boardPositions = useMemo(() => groupPositions(filteredEntries), [filteredEntries]);
  // drawer-loop-hygiene — the drawer's prev/next cohort is the board's VISIBLE
  // sequence (lane by lane, stage column by column, within-cell order), not the
  // global filtered sort — so "next" walks the column the recruiter is reading
  // instead of jumping across stages. Derived from the same boardPositions +
  // filteredEntries the board renders, so it can never diverge from what's on screen.
  const boardColumns = useMemo(() => board.axis.map((s) => s.id), [board.axis]);
  const cohortOrder = useMemo(
    () => boardVisibleOrder(boardPositions, filteredEntries, boardColumns),
    [boardPositions, filteredEntries, boardColumns]
  );

  // Bulk select mode + the four batch actions, resolved against exactly what the
  // board renders (filteredEntries) and scoped by what it was showing (visibleScope).
  const bulk = usePipelineBulk({ t, entries, filteredEntries, visibleScope, relayConfigured, load });
  const nav = usePipelineNavigation({ entries, setDrawerEntry });

  // drawer-flow-friction — the degraded/needs-intake chip ARMS the board's existing
  // `intake` quick filter (reused, not forked) so the whole stub cohort is isolated,
  // then opens the first one; the drawer's prev/next then walks the now-filtered
  // cohort (cohortOrder) stub-by-stub instead of the old open-degraded[0]-only
  // dead end. Clears the other facets so the board shows exactly the needs-intake set.
  const focusDegradedCohort = () => {
    const quicksSet = new Set<QuickFilter>(["intake"]);
    const empty = emptyFacets();
    filters.setAllFilters({ q: "", quicks: quicksSet, scoreBands: empty.scoreBands, sources: empty.sources, sort, stage: null });
    // drawer-loop-hygiene — single-source the opened entry: derive it from the SAME
    // predicate + array the board is about to show (the intake-filtered set, in the
    // board's visible order) rather than the separate unfiltered `degraded` list. So
    // "open" and prev/next walk one cohort — the opened stub is genuinely cohort[0].
    const cohort = (entries ?? []).filter((e) =>
      entryMatchesFilters(
        e,
        { query: "", quicks: quicksSet, scoreBands: empty.scoreBands, sources: empty.sources, stage: null },
        { overrides: slaOverrides, axis: board.axis }
      )
    );
    const sorted = sortFilteredEntries(cohort, sort);
    const ordered = boardVisibleOrder(groupPositions(sorted), sorted, boardColumns);
    if (ordered.length > 0) setDrawerEntry(ordered[0]);
  };

  // Reload the board when a background batch-screen finishes (it mutates many entries).
  useEffect(() => {
    const done = tasks.find((t) => t.kind === "batch_screen" && t.status === "succeeded");
    if (done?.finishedAt && done.finishedAt !== lastBatchDone.current) {
      lastBatchDone.current = done.finishedAt;
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  return {
    t, channelName, relayConfigured,
    entries, events, error, eventsError, load,
    drawerEntry, setDrawerEntry,
    query, setQueryAndSync: filters.setQueryAndSync,
    quicks, toggleQuick: filters.toggleQuick,
    scoreBands, toggleBand: filters.toggleBand,
    sources, toggleSource: filters.toggleSource, sourceValues,
    sort, setSortAndSync: filters.setSortAndSync,
    stageFilter, clearStageFilter: filters.clearStageFilter, showStage: filters.showStage, clearFilters: filters.clearFilters,
    selectMode: bulk.selectMode, toggleSelectMode: bulk.toggleSelectMode,
    selectedIds: bulk.selectedIds, toggleSelected: bulk.toggleSelected, selectAllVisible: bulk.selectAllVisible,
    clearSelection: bulk.clearSelection, selectedOutsideCount: bulk.selectedOutsideCount,
    bulkStage: bulk.bulkStage, setBulkStage: bulk.setBulkStage, bulkBusy: bulk.bulkBusy, bulkResult: bulk.bulkResult,
    confirmingBulkReject: bulk.confirmingBulkReject, confirmingBulkOutreach: bulk.confirmingBulkOutreach,
    dispatchBulkConfirm: bulk.dispatchBulkConfirm,
    views: savedViews.views, viewDialog: savedViews.viewDialog, setViewDialog: savedViews.setViewDialog,
    openSaveView: savedViews.openSaveView, openRenameView: savedViews.openRenameView,
    commitViewDialog: savedViews.commitViewDialog,
    toggleDefaultView: savedViews.toggleDefaultView, applyView: savedViews.applyView, deleteView: savedViews.deleteView,
    activeViewId: savedViews.activeViewId, copyViewLink: savedViews.copyViewLink, copiedViewId: savedViews.copiedViewId,
    slaOverrides, setStageSla, editingSla, setEditingSla,
    positions, activeCount, interviewCount, staleCount, degradedCount, approvals,
    filteredEntries, boardPositions, cohortOrder, filtering,
    axis: board.axis, retiredStages: board.retiredStages,
    isStale, moveError, moveErrorEntryId, dismissMoveError, moveEntry,
    openActions: nav.openActions, openEntryById: nav.openEntryById, openProfile: nav.openProfile,
    openJob: nav.openJob, openPositionRanking: nav.openPositionRanking, goToDecisions: nav.goToDecisions,
    selectedAwaiting: bulk.selectedAwaiting, awaitingKinds: bulk.awaitingKinds, selectedActive: bulk.selectedActive,
    bulkMove: bulk.bulkMove, bulkDecide: bulk.bulkDecide, bulkInvite: bulk.bulkInvite, bulkOutreach: bulk.bulkOutreach,
    outreachTaskActive: bulk.outreachTaskActive,
    sim,
    focusDegradedCohort,
    SCORE_BANDS,
  };
}

export type PipelineTabState = ReturnType<typeof usePipelineTabState>;
