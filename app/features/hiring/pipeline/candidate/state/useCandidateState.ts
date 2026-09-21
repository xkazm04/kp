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

import { useState } from "react";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry as BoardEntry } from "@/app/features/shared/pipelineTypes";
import type { Entry } from "../../PipelineCandidateDrawerTypes";
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
    showTranscript,
    setShowTranscript,
    cohortIndex,
    prevEntry,
    nextEntry,
  };
}

export type CandidateState = ReturnType<typeof useCandidateState>;
