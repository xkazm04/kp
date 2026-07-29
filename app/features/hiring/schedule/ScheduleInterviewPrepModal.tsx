"use client";

import { Check, Copy, RefreshCw } from "lucide-react";
import { HumanScorecardPanel } from "./ScheduleHumanScorecardPanel";
import { Modal } from "@/app/_components/Modal";
import type { SchedEntry } from "./ScheduleTypes";
import { useScheduleInterviewPrep } from "./useScheduleInterviewPrep";
import { PrepLoadStates } from "./ScheduleInterviewPrepLoadStates";
import { PrepHeader } from "./ScheduleInterviewPrepHeader";
import { RunOfShow } from "./ScheduleInterviewPrepRunOfShow";
import { SignalsToConfirm, ImportedQuestionsSection } from "./ScheduleInterviewPrepQuestions";
import { InterviewerAndNotes } from "./ScheduleInterviewPrepNotes";

export function InterviewPrepModal({ entry, onClose }: { entry: SchedEntry; onClose: () => void }) {
  const {
    t,
    prep,
    loading,
    error,
    reload,
    generate,
    generating,
    fallback,
    stale,
    jdEditedLabel,
    copied,
    copyPrep,
    checked,
    setChecked,
    markEdited,
    notes,
    setNotes,
    interviewer,
    setInterviewer,
    signals,
    wovenForBlock,
    wovenKeyOf,
    unassigned,
    pickerFor,
    setPickerFor,
    setBlock,
    totalItems,
    doneItems,
  } = useScheduleInterviewPrep(entry);

  return (
    <Modal
      title={t("title", { name: entry.candidateLabel })}
      subtitle={entry.jobTitle ?? undefined}
      onClose={onClose}
      size="3xl"
      footer={
        prep ? (
          <>
            <button
              type="button"
              onClick={copyPrep}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
            >
              {copied ? <Check size={14} className="text-moss" /> : <Copy size={14} />}
              {copied ? t("copied") : t("copyPrep")}
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
            >
              <RefreshCw size={14} /> {generating ? t("generating") : t("regenerate")}
            </button>
          </>
        ) : null
      }
    >
      {!prep ? (
        <PrepLoadStates loading={loading} generating={generating} error={error} reload={reload} generate={generate} t={t} />
      ) : (
        <div className="space-y-4">
          <PrepHeader
            prep={prep}
            fallback={fallback}
            stale={stale}
            jdEditedLabel={jdEditedLabel}
            generate={generate}
            generating={generating}
            totalItems={totalItems}
            doneItems={doneItems}
            t={t}
          />

          <RunOfShow
            prep={prep}
            checked={checked}
            setChecked={setChecked}
            markEdited={markEdited}
            wovenForBlock={wovenForBlock}
            wovenKeyOf={wovenKeyOf}
            setBlock={setBlock}
            t={t}
          />

          <SignalsToConfirm signals={signals} checked={checked} setChecked={setChecked} markEdited={markEdited} t={t} />

          {/* Questions imported from the candidate's analysis report (Direction 2):
              reference material the interviewer can WEAVE into a timed block (Direction
              3). Once woven, a question moves up into its block above; only the
              still-unassigned ones remain here. */}
          <ImportedQuestionsSection
            prep={prep}
            unassigned={unassigned}
            pickerFor={pickerFor}
            setPickerFor={setPickerFor}
            setBlock={setBlock}
            t={t}
          />

          <InterviewerAndNotes
            interviewer={interviewer}
            setInterviewer={setInterviewer}
            notes={notes}
            setNotes={setNotes}
            markEdited={markEdited}
            t={t}
          />

          {/* Human scorecard (PREP1): fill the role's rubric live and save it
              against this candidate — the human counterpart to the AI voice-screen
              scorecard. Hydrated from the freshest payload: a regenerated result
              carries the saved scorecard forward, so never read the stale GET. */}
          <HumanScorecardPanel entryId={entry.id} archetype={entry.archetype} roleFamily={entry.roleFamily} initial={prep.humanScorecard} />
        </div>
      )}
    </Modal>
  );
}
