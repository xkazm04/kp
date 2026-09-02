"use client";

// The BODY of the board panel: the select-mode bulk bar, the SLA editor, saved views
// + its dialog, and the board itself (or the no-match message). Split out of
// PipelineTab.tsx — shown only once entries have loaded and the board isn't empty.
//
// Two things that used to render here have moved OUT, and the reason is the same in
// both cases: they came between the filter header and the first candidate card.
//   - the degraded + approvals banners → PipelineAttentionStrip, one consolidated
//     surface above the Getting-started card (a stalled application outranks setup)
//   - the activity feed → below the board panel in PipelineTab, deferred until it
//     scrolls into view
// What is left is what genuinely belongs between the filters and the lanes: the
// modes those filters arm.

import { PipelineBoard } from "./PipelineBoard";
import { PipelineBulkActionBar } from "./PipelineBulkActionBar";
import { PipelineSlaEditor } from "./PipelineSlaEditor";
import { PipelineSavedViews } from "./PipelineSavedViews";
import { PipelineViewDialog, type ViewDialogState } from "./PipelineViewDialog";
import { Collapse, FadeSwap } from "./PipelineMotion";
import type { PipelineTabState } from "./usePipelineTabState";

export function PipelinePopulatedBoard({
  s,
  enumLabel,
}: {
  s: PipelineTabState;
  enumLabel: (kind: string, value: string) => string;
}) {
  const noMatch = s.filtering && s.filteredEntries.length === 0;
  return (
    <>
      {/* PIPE1: the batch action bar — pairs with the filters above (filter
          to the cohort, select all shown, move them in one pass). Both this and the
          SLA editor are armed by a toggle in the header directly above them, so
          they OPEN (height + fade) instead of appearing whole: the lanes below get
          pushed down at the same speed the strip grows, which is what makes the
          toggle feel connected to what it toggled. */}
      <Collapse show={s.selectMode}>
        <div className="border-b border-stone-200 px-4 py-3">
          <PipelineBulkActionBar
            t={s.t}
            enumLabel={enumLabel}
            axis={s.axis}
            relayConfigured={s.relayConfigured}
            selectedIds={s.selectedIds}
            selectedOutsideCount={s.selectedOutsideCount}
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
        </div>
      </Collapse>

      <Collapse show={s.editingSla}>
        <div className="border-b border-stone-200 px-4 py-3">
          <PipelineSlaEditor
            t={s.t}
            enumLabel={enumLabel}
            axis={s.axis}
            slaOverrides={s.slaOverrides}
            onChangeStageSla={s.setStageSla}
          />
        </div>
      </Collapse>

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

      {/* Filtering down to nothing and back is the most abrupt swap on the page —
          the lanes vanish and a line of text takes their place. Crossfaded (and
          sequenced, so the two never overlap) instead of hard-cut. */}
      <FadeSwap swapKey={noMatch ? "no-match" : "board"}>
        {noMatch ? (
          <p className="bg-paper px-4 py-6 text-base text-steel">
            {s.t("noMatch")}{" "}
            <button
              type="button"
              onClick={s.clearFilters}
              className="font-semibold text-coral underline underline-offset-2 transition-colors hover:text-coral/80"
            >
              {s.t("clearFilters")}
            </button>
          </p>
        ) : (
          <div data-sim="pipeline-board">
            <PipelineBoard
              positions={s.boardPositions}
              entries={s.filteredEntries}
              axis={s.axis}
              retiredStages={s.retiredStages}
              isStale={s.isStale}
              openPositionRanking={s.openPositionRanking}
              openProfile={s.openProfile}
              openJob={s.openJob}
              openActions={s.openActions}
              selectMode={s.selectMode}
              selectedIds={s.selectedIds}
              onToggleSelect={s.toggleSelected}
              onMove={s.moveEntry}
              // The refused move, shown ON the card that bounced back (the page-level
              // banner sits above a board that is usually scrolled away from it).
              bouncedEntryId={s.moveErrorEntryId}
              bouncedReason={s.moveError}
            />
          </div>
        )}
      </FadeSwap>
    </>
  );
}
