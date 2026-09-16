"use client";

// Everything the candidate modal knows about ONE entry: the per-entry state (bundle,
// notes, AI tasks, links, stage move — state/useCandidateState.ts), the role ranking
// the Scorecard reads, and the header / tabs / three panels / action footer that
// render them. Keyed by entry id in CandidateModal, so stepping to a neighbour
// resets it.
//
// All three panels stay MOUNTED and only the active one is visible: a panel's own
// fetch (the hire outcome card) runs once per open rather than once per tab visit,
// and a half-typed note survives a look at the Activity tab. The footer is outside
// the panels, so every action is one click away whichever tab is open.

import { useCallback, useMemo } from "react";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { InterviewTranscriptModal } from "@/app/features/hiring/schedule/ScheduleInterviewTranscriptModal";
import { roleBandOf } from "../map/mapSalary";
import { useCellMatchData } from "../map/useCellMatchData";
import { CandidateActivityTab } from "./CandidateActivityTab";
import type { CandidateModalProps } from "./CandidateModal";
import { CandidateModalHeader } from "./CandidateModalHeader";
import { CandidateModalTabs, tabIds } from "./CandidateModalTabs";
import { CandidateOverviewTab } from "./CandidateOverviewTab";
import { CandidateRecordTab } from "./CandidateRecordTab";
import { schedEntryOf, type CandidateTab } from "./candidateView";
import { CandidateFooter } from "./footer/CandidateFooter";
import { candidateDetailModel } from "./scorecard/candidateDetailModel";
import { useCandidateState } from "./state/useCandidateState";

export function CandidateModalBody({
  view,
  boardCohort,
  axis,
  onClose,
  onChanged,
  onOpenEntry,
  onNavigate,
  onTab,
  titleId,
}: CandidateModalProps & { titleId: string }) {
  const { entry, tab } = view;
  const cohort = view.cohort ?? boardCohort;
  const st = useCandidateState({ entry, axis, onClose, onChanged, onOpenEntry, cohort });

  const { matchByCandidate, matchLoading, matchError } = useCellMatchData(entry.jobId);
  const match = entry.candidateId ? matchByCandidate.get(entry.candidateId) : undefined;
  const roleBand = useMemo(() => roleBandOf(matchByCandidate), [matchByCandidate]);
  const model = useMemo(() => candidateDetailModel(entry, match, axis, roleBand), [entry, match, axis, roleBand]);

  const enumLabel = useEnumLabel();
  // A workspace-renamed column shows its own label, a shipped one the enum catalog.
  const stageLabel = useCallback(
    (stage: StageDef) => (stage.label === stage.id ? enumLabel("stage", stage.id) : stage.label),
    [enumLabel],
  );
  const labelOf = (stageId: string) => {
    const def = axis.find((s) => s.id === stageId);
    return def ? stageLabel(def) : enumLabel("stage", stageId);
  };
  const panel = (id: CandidateTab) => ({
    role: "tabpanel",
    id: tabIds(id).panel,
    "aria-labelledby": tabIds(id).tab,
    hidden: tab !== id,
    tabIndex: 0,
    className: "focus-ring outline-none",
  });

  return (
    <>
      <CandidateModalHeader
        entry={entry}
        titleId={titleId}
        stageText={labelOf(entry.stage)}
        axis={axis}
        staleSince={st.staleSince}
        pager={
          st.cohortIndex >= 0 && cohort.length > 1
            ? { index: st.cohortIndex, total: cohort.length, prev: st.prevEntry, next: st.nextEntry, onNavigate }
            : null
        }
        onBack={onClose}
      />
      <CandidateModalTabs tab={tab} onTab={onTab} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div {...panel("overview")}>
          <CandidateOverviewTab
            entry={entry}
            axis={axis}
            model={model}
            stageLabel={stageLabel}
            matchLoading={matchLoading}
            matchError={matchError}
            st={st}
          />
        </div>
        <div {...panel("activity")}>
          <CandidateActivityTab st={st} onOpenEntry={onOpenEntry} />
        </div>
        <div {...panel("record")}>
          <CandidateRecordTab entry={entry} st={st} />
        </div>
      </div>
      <CandidateFooter
        entry={entry}
        axis={axis}
        st={st}
        nextStage={model.nextStage}
        stageLabel={stageLabel}
        labelOf={labelOf}
      />

      {/* Stacked over the modal through the shared Modal portal + dialog stack:
          Escape closes the transcript first, then the candidate. */}
      {st.showTranscript ? (
        <InterviewTranscriptModal entry={schedEntryOf(entry)} onClose={() => st.setShowTranscript(false)} />
      ) : null}
    </>
  );
}
