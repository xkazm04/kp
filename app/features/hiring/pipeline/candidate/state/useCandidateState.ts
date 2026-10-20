"use client";

// Everything the candidate modal knows about ONE open entry, composed from
// single-concern hooks (it was one 594-line hook when this was the drawer):
//
//   useCandidateBundle  the one-call story (history, comms, interview, consent…)
//   useCandidateNote    the autosaved, close-flushed recruiter note
//   useCandidateTask    the AI task run and its result
//   useCandidateLinks   voice-screen / self-scheduling links, revoke, their gate
//   useCandidateEdits   stage move, intake recovery, GitHub deep-dive
//
// The order below is the order the effects used to register in (bundle first, so
// the note can reconcile with it). The flat return keeps the tabs' `st.*` reads.

import { useEffect, useState } from "react";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry as BoardEntry } from "@/app/features/shared/pipelineTypes";
import type { Entry } from "../../PipelineCandidateDrawerTypes";
import { invalidatesBundle } from "./candidateBundle";
import { useCandidateBundle } from "./useCandidateBundle";
import { useCandidateEdits } from "./useCandidateEdits";
import { useCandidateLinks } from "./useCandidateLinks";
import { useCandidateNote } from "./useCandidateNote";
import { useCandidateTask } from "./useCandidateTask";

export function useCandidateState({
  entry,
  axis,
  onClose,
  onChanged,
  onOpenEntry,
  cohort,
}: {
  entry: Entry;
  axis: readonly StageDef[];
  onClose: () => void;
  onChanged: () => void;
  onOpenEntry?: (entryId: string) => void;
  cohort: readonly BoardEntry[];
}) {
  const bundle = useCandidateBundle(entry);
  const note = useCandidateNote({ entryId: entry.id, initial: entry.notes, bundleNotes: bundle.bundleNotes, onChanged });
  const task = useCandidateTask({ entry, onChanged });
  const links = useCandidateLinks({ entry, axis });
  const edits = useCandidateEdits({ entry, onChanged, onClose, onOpenEntry });

  // The modal's OWN writes re-pull the story (candidateBundle.ts `invalidatesBundle`
  // is the one declared answer per write). Each is keyed on a fresh object per
  // completion - a task result, a minted link's payload - so one write, one re-pull.
  const { invalidate } = bundle;
  const { result: taskResult } = task;
  useEffect(() => {
    if (taskResult && invalidatesBundle({ kind: "task", applied: taskResult.applied })) invalidate();
  }, [taskResult, invalidate]);
  // useTokenLink sets `data` only on a successful mint (and clears it when a new one
  // starts), so non-null data IS "minted": the invite letter and the timeline row exist.
  const schedMinted = links.sched.data;
  useEffect(() => {
    if (invalidatesBundle({ kind: "link", flow: "schedule", minted: schedMinted !== null })) invalidate();
  }, [schedMinted, invalidate]);
  const voiceMinted = links.voice.data;
  useEffect(() => {
    if (invalidatesBundle({ kind: "link", flow: "voice", minted: voiceMinted !== null })) invalidate();
  }, [voiceMinted, invalidate]);
  // A resend from the Activity tab's letter door (PipelineCommsList onResent).
  const onLetterResent = () => {
    if (invalidatesBundle({ kind: "resend" })) invalidate();
  };
  // Opened from the interview outcome card; stacked over the modal.
  const [showTranscript, setShowTranscript] = useState(false);

  // drawer-flow-friction — prev/next WITHIN the cohort, no wrap. A counterpart opened
  // off-board (a rematch link) is not in the cohort, so the pager hides for it.
  const cohortIndex = cohort.findIndex((e) => e.id === entry.id);
  const prevEntry = cohortIndex > 0 ? cohort[cohortIndex - 1] : null;
  const nextEntry = cohortIndex >= 0 && cohortIndex < cohort.length - 1 ? cohort[cohortIndex + 1] : null;

  return {
    ...bundle,
    ...note,
    ...task,
    ...links,
    ...edits,
    onLetterResent,
    showTranscript,
    setShowTranscript,
    cohortIndex,
    prevEntry,
    nextEntry,
  };
}

export type CandidateState = ReturnType<typeof useCandidateState>;
