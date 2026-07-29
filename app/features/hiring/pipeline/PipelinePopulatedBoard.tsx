"use client";

// The pipeline tab's populated-board content: the degraded/approvals banners,
// the select-mode bulk bar, the SLA editor, saved views + its dialog, the board
// itself (or the no-match message), and the activity feed. Split out of
// PipelineTab.tsx — shown only once entries have loaded and the board isn't
// empty; everything here is wired straight to usePipelineTabState.

import { AlertTriangle } from "lucide-react";
import { PipelineBoard } from "./PipelineBoard";
import { PipelineBulkActionBar } from "./PipelineBulkActionBar";
import { PipelineSlaEditor } from "./PipelineSlaEditor";
import { PipelineSavedViews } from "./PipelineSavedViews";
import { PipelineViewDialog, type ViewDialogState } from "./PipelineViewDialog";
import { PipelineActivityFeed } from "./PipelineActivityFeed";
import type { PipelineTabState } from "./usePipelineTabState";
import type { PipelineEvent } from "@/app/features/shared/pipelineTypes";

export function PipelinePopulatedBoard({
  s,
  enumLabel,
  eventVerb,
  relativeTime,
}: {
  s: PipelineTabState;
  enumLabel: (kind: string, value: string) => string;
  eventVerb: (ev: PipelineEvent) => string;
  relativeTime: (at: string) => string;
}) {
  return (
    <>
      {s.degradedCount > 0 ? (
        <button
          type="button"
          onClick={s.focusDegradedCohort}
          className="focus-ring flex w-full items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left hover:bg-red-100"
        >
          <span className="flex min-w-0 items-center gap-2 text-base text-ink">
            <AlertTriangle size={16} className="shrink-0 text-red-600" aria-hidden />
            <span>
              <span className="font-semibold text-red-700">{s.t("degradedBannerCount", { count: s.degradedCount })}</span>{" "}
              {s.t("degradedBannerBody", { count: s.degradedCount })}
            </span>
          </span>
          <span className="shrink-0 text-base font-semibold text-red-700">{s.t("review")}</span>
        </button>
      ) : null}

      {s.approvals.length > 0 ? (
        <button
          type="button"
          onClick={s.goToDecisions}
          className="focus-ring flex w-full items-center justify-between rounded-lg border border-coral/30 bg-coral/5 px-4 py-3 text-left hover:bg-coral/10"
        >
          <span className="text-base text-ink">
            <span className="font-semibold text-coral">{s.t("approvalsCount", { count: s.approvals.length })}</span>{" "}
            {s.t("approvalsBody")}
          </span>
          <span className="text-base font-semibold text-coral">{s.t("openDecisions")}</span>
        </button>
      ) : null}

      {/* PIPE1: the batch action bar — pairs with the filters above (filter
          to the cohort, select all shown, move them in one pass). */}
      {s.selectMode ? (
        <PipelineBulkActionBar
          t={s.t}
          enumLabel={enumLabel}
          relayConfigured={s.relayConfigured}
          selectedIds={s.selectedIds}
          filteredCount={s.filteredEntries.length}
          onSelectAllVisible={s.selectAllVisible}
          onClearSelection={s.clearSelection}
          bulkStage={s.bulkStage}
          onBulkStageChange={s.setBulkStage}
          onBulkMove={() => void s.bulkMove()}
          bulkBusy={s.bulkBusy}
          selectedActive={s.selectedActive}
          onBulkInvite={() => void s.bulkInvite()}
          confirmingBulkOutreach={s.confirmingBulkOutreach}
          dispatchBulkConfirm={s.dispatchBulkConfirm}
          onBulkOutreach={() => void s.bulkOutreach()}
          outreachTaskActive={s.outreachTaskActive}
          bulkResult={s.bulkResult}
          selectedAwaiting={s.selectedAwaiting}
          awaitingKinds={s.awaitingKinds}
          onBulkDecide={(action) => void s.bulkDecide(action)}
          confirmingBulkReject={s.confirmingBulkReject}
        />
      ) : null}

      {s.editingSla ? (
        <PipelineSlaEditor t={s.t} enumLabel={enumLabel} slaOverrides={s.slaOverrides} onChangeStageSla={s.setStageSla} />
      ) : null}

      <PipelineSavedViews
        t={s.t}
        views={s.views}
        activeViewId={s.activeViewId}
        copiedViewId={s.copiedViewId}
        onToggleDefault={s.toggleDefaultView}
        onApply={s.applyView}
        onRename={s.openRenameView}
        onCopyLink={(v) => void s.copyViewLink(v)}
        onDelete={s.deleteView}
      />

      {/* views-earn-their-name — save/rename dialog (the app's Modal idiom,
          replacing window.prompt). A save under an existing name overwrites,
          made explicit inline; the "open by default" toggle marks the view that
          opens on a bare visit. */}
      {s.viewDialog ? (
        <PipelineViewDialog
          t={s.t}
          dialog={s.viewDialog as ViewDialogState}
          onChange={(next) => s.setViewDialog(next)}
          onClose={() => s.setViewDialog(null)}
          onCommit={s.commitViewDialog}
          views={s.views}
        />
      ) : null}

      {s.filtering && s.filteredEntries.length === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-paper p-4 text-base text-steel">
          {s.t("noMatch")}{" "}
          <button type="button" onClick={s.clearFilters} className="font-semibold text-coral underline underline-offset-2">
            {s.t("clearFilters")}
          </button>
        </p>
      ) : (
        <div data-sim="pipeline-board">
          <PipelineBoard
            positions={s.boardPositions}
            entries={s.filteredEntries}
            isStale={s.isStale}
            openPositionRanking={s.openPositionRanking}
            openProfile={s.openProfile}
            openJob={s.openJob}
            openActions={s.openActions}
            selectMode={s.selectMode}
            selectedIds={s.selectedIds}
            onToggleSelect={s.toggleSelected}
            onMove={s.moveEntry}
          />
        </div>
      )}

      <PipelineActivityFeed
        t={s.t}
        eventsError={s.eventsError}
        events={s.events}
        eventVerb={eventVerb}
        relativeTime={relativeTime}
      />
    </>
  );
}
