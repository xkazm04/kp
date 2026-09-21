"use client";

// Record — what is KEPT about the candidate: the persistent recruiter note (autosaved,
// flushed on close), the GitHub evidence (or the deep-dive that attaches it), the
// GDPR consent snapshot with its audit trail, and the links out to the full match
// and the profile editor.

import type { Entry } from "@/app/features/shared/pipelineTypes";
import { PipelineCandidateNoteField } from "../PipelineCandidateNoteField";
import { ConsentPanel } from "../PipelineConsentPanel";
import { PipelineDrawerFooterLinks } from "../PipelineDrawerFooterLinks";
import { PipelineGithubEvidenceCard } from "../PipelineGithubEvidenceCard";
import type { CandidateState } from "./state/useCandidateState";

export function CandidateRecordTab({ entry, st }: { entry: Entry; st: CandidateState }) {
  const { bundleFailed } = st;
  return (
    <div className="grid gap-6 p-4 sm:p-6 md:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <PipelineCandidateNoteField
          value={st.candNote}
          status={st.noteStatus}
          maxLength={st.NOTE_MAX}
          onChange={st.changeNote}
        />
        <PipelineGithubEvidenceCard
          github={st.github}
          githubHandle={entry.githubHandle}
          ghBusy={st.ghBusy}
          ghErr={st.ghErr}
          onRunDeepDive={st.runGithubDeepDive}
        />
      </div>
      <div className="min-w-0 space-y-4">
        {/* The consent snapshot rides the one-call bundle (view=), so the panel fires
            no fetch of its own; loadFailed is the bundle's give-up signal, without
            which a failed load left this GDPR panel "loading…" for ever. */}
        <ConsentPanel key={entry.id} entryId={entry.id} view={st.consent} loadFailed={bundleFailed} />
        <PipelineDrawerFooterLinks candidateId={entry.candidateId} />
      </div>
    </div>
  );
}
