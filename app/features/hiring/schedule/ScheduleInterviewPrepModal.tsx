"use client";

import { Check, Copy, RefreshCw } from "lucide-react";
import { HumanScorecardPanel } from "./ScheduleHumanScorecardPanel";
import { Modal } from "@/app/_components/Modal";
import { rubricCoverage } from "@/app/_lib/interview-rubric";
import type { SchedEntry } from "./ScheduleTypes";
import { useScheduleInterviewPrep } from "./useScheduleInterviewPrep";
import { PrepLoadStates } from "./ScheduleInterviewPrepLoadStates";
import { PrepHeader } from "./ScheduleInterviewPrepHeader";
import { RunOfShow } from "./ScheduleInterviewPrepRunOfShow";
import { SignalsToConfirm, ImportedQuestionsSection } from "./ScheduleInterviewPrepQuestions";
import { InterviewerAndNotes } from "./ScheduleInterviewPrepNotes";
import { PrepKitOverlay } from "./ScheduleInterviewPrepOverlay";
import { PrepPlanDiff } from "./ScheduleInterviewPrepPlanDiff";

export function InterviewPrepModal({ entry, onClose }: { entry: SchedEntry; onClose: () => void }) {
  const {
    t,
    prep,
    kit,
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
    planDiff,
    decidePlan,
    deciding,
    decideFailed,
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
            coverage={rubricCoverage(entry.roleFamily)}
            fallback={fallback}
            stale={stale}
            jdEditedLabel={jdEditedLabel}
            generate={generate}
            generating={generating}
            totalItems={totalItems}
            doneItems={doneItems}
            t={t}
          />

          {/* A staged Regenerate (r09 schedule-interview-prep/B): the new plan waits
              here as a diff; the run-of-show below stays the committed one, usable,
              until the interviewer replaces it or keeps it. */}
          {planDiff ? <PrepPlanDiff diff={planDiff} decide={decidePlan} deciding={deciding} failed={decideFailed} t={t} /> : null}

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

          {/* The job interview kit this candidate's AI interview runs on, with the
              recruiter's per-candidate overlay (spark interview-kit-template): drop,
              rewrite or add a question for THIS candidate. Renders nothing when the
              role has no kit. */}
          <PrepKitOverlay entryId={entry.id} kit={kit} prep={prep} />

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
              scorecard. Seeded from the CALLER'S OWN record for this round (the panel
              asks GET /api/interview-prep/scorecard for `mine`), never from
              prep.humanScorecard: that headline is whoever saved last, and passing it
              here pre-filled a second interviewer's form with the first one's verdict
              (r09 schedule-interview-prep/A). */}
          <HumanScorecardPanel entryId={entry.id} archetype={entry.archetype} roleFamily={entry.roleFamily} />
        </div>
      )}
    </Modal>
  );
}
