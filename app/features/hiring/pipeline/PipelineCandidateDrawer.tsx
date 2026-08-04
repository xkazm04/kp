"use client";

import { useTranslations } from "next-intl";
import { ResultView } from "./PipelineCandidateResultView";
import { ConsentPanel } from "./PipelineConsentPanel";
import { InterviewTranscriptModal } from "@/app/features/hiring/schedule/ScheduleInterviewTranscriptModal";
import type { SchedEntry } from "@/app/features/hiring/schedule/ScheduleTypes";
import type { Entry, PipelineCandidateDrawerProps } from "./PipelineCandidateDrawerTypes";
import { usePipelineCandidateDrawerState } from "./usePipelineCandidateDrawerState";
import { PipelineDrawerHeader } from "./PipelineDrawerHeader";
import { PipelineDegradedIntakeBanner } from "./PipelineDegradedIntakeBanner";
import { PipelineInterviewOutcomeCard } from "./PipelineInterviewOutcomeCard";
import { PipelineHumanScorecardCard } from "./PipelineHumanScorecardCard";
import { PipelineGithubEvidenceCard } from "./PipelineGithubEvidenceCard";
import { PipelineCommsList } from "./PipelineCommsList";
import { PipelineDrawerHistoryList } from "./PipelineDrawerHistoryList";
import { PipelineMoveStageControl } from "./PipelineMoveStageControl";
import { PipelineCandidateNoteField } from "./PipelineCandidateNoteField";
import { PipelineAiActionsGrid, pipelineDrawerActionsFor } from "./PipelineAiActionsGrid";
import { PipelineVoiceScreenPanel } from "./PipelineVoiceScreenPanel";
import { PipelineSelfSchedulingPanel } from "./PipelineSelfSchedulingPanel";
import { PipelineDrawerFooterLinks } from "./PipelineDrawerFooterLinks";

// `onOpenEntry` (rematch-story-navigable): open another entry's drawer by id — the
// counterpart of a re-engagement link, resolved server-side. Absent ⇒ the story
// renders read-only. Also drives the in-place refresh after a stage move.
// `cohort`/`onNavigate` (drawer-flow-friction): the board's CURRENTLY-FILTERED entry
// list, so prev/next walks exactly the cohort the recruiter filtered to. Typed against
// the full board Entry — the drawer's own `entry` prop is a narrower pick — so a
// neighbor round-trips back to setDrawerEntry.
export function CandidateDrawer({ entry, onClose, onChanged, onOpenEntry, cohort, onNavigate }: PipelineCandidateDrawerProps) {
  const t = useTranslations("pipeline.drawer");
  // Destructured, not held as one `st` object: the hook returns refs alongside
  // plain state, and reading them off a shared object during render trips the
  // react-hooks/refs rule (the pre-split component held these as locals).
  const {
    NOTE_MAX, bundleFailed, busy, candNote, cohortIndex, comms, consent, dialogRef, error, ghBusy, ghErr, github,
    humanSc, intakeErr, ivOutcome, mergedHistory, moveErr, moveStage, movingStage, nextEntry,
    noteDirtyRef, noteStatus, prevEntry, rematchLinks, resolveIntake, resolvingIntake, result,
    revokeLinks, revokeNote, run, runGithubDeepDive, sched, setCandNote, setShowTranscript,
    setVoiceProvider, showLinks, showTranscript, staleSince, timelineErr, voice, voiceProvider,
  } = usePipelineCandidateDrawerState({ entry, onClose, onChanged, onOpenEntry, cohort });
  const showCohortNav = Boolean(onNavigate) && cohort != null && cohortIndex >= 0 && cohort.length > 1;
  const actions = pipelineDrawerActionsFor(entry);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label={t("close")} onClick={onClose} className="absolute inset-0 bg-ink/20 backdrop-blur-[1px]" />
      <aside
        ref={dialogRef as React.RefObject<HTMLElement>}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className="animate-slide-in relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-stone-200 bg-paper shadow-overlay"
      >
        <PipelineDrawerHeader
          entry={entry}
          staleSince={staleSince}
          cohortIndex={cohortIndex}
          cohortLength={cohort?.length ?? 0}
          prevEntry={prevEntry}
          nextEntry={nextEntry}
          showCohortNav={showCohortNav}
          onNavigatePrev={() => prevEntry && onNavigate!(prevEntry)}
          onNavigateNext={() => nextEntry && onNavigate!(nextEntry)}
          onClose={onClose}
        />

        <div className="space-y-4 p-4">
          {entry.intakeDegraded ? (
            <PipelineDegradedIntakeBanner
              reason={entry.intakeDegradedReason}
              resolving={resolvingIntake}
              intakeErr={intakeErr}
              onResolve={resolveIntake}
            />
          ) : null}

          {ivOutcome ? (
            <PipelineInterviewOutcomeCard ivOutcome={ivOutcome} onShowTranscript={() => setShowTranscript(true)} />
          ) : null}

          {humanSc ? <PipelineHumanScorecardCard humanSc={humanSc} /> : null}

          {/* GH2 — GitHub evidence attached at add-to-pipeline (or just run from
              this drawer): corroborated vs claimed skills beside the interview
              outcomes, at the surface where advance/reject actually happens. */}
          <PipelineGithubEvidenceCard
            github={github}
            githubHandle={entry.githubHandle}
            ghBusy={ghBusy}
            ghErr={ghErr}
            onRunDeepDive={runGithubDeepDive}
          />

          {/* W6-2 — what this candidate actually received (full letters, not
              just the event line), with failed sends visible at the source. */}
          {comms && comms.length > 0 ? <PipelineCommsList comms={comms} /> : null}

          {/* single-entry-authz-parity — a permission refusal on the bundle fetch
              would otherwise leave the timeline silently empty; name it instead. */}
          {timelineErr ? <p role="alert" className="text-sm text-red-700">{timelineErr}</p> : null}

          <PipelineDrawerHistoryList
            mergedHistory={mergedHistory}
            rematchLinks={rematchLinks}
            onOpenEntry={onOpenEntry}
          />

          {entry.status === "active" ? (
            <PipelineMoveStageControl
              stage={entry.stage}
              movingStage={movingStage}
              moveErr={moveErr}
              onMoveStage={moveStage}
            />
          ) : null}

          {/* Persistent candidate note: always visible, debounce-autosaved to the
              entry (set_notes) with a quiet saving/saved hint — the durable home
              for call facts the Interview-only scorecard box used to swallow. */}
          <PipelineCandidateNoteField
            value={candNote}
            status={noteStatus}
            maxLength={NOTE_MAX}
            onChange={(value) => {
              noteDirtyRef.current = true;
              setCandNote(value);
            }}
          />

          {/* Consent snapshot rides the one-call bundle (view=), so ConsentPanel
              fires no second fetch on open — the drawer opens with a single request.
              loadFailed is the bundle's give-up signal: without it a failed fetch left
              this GDPR panel claiming "loading…" forever (drawer-comms-truth). */}
          <ConsentPanel key={entry.id} entryId={entry.id} view={consent} loadFailed={bundleFailed} />

          <PipelineAiActionsGrid
            actions={actions}
            busy={busy}
            result={result}
            onRun={(task) => void run(task, candNote)}
          />

          {showLinks ? (
            <PipelineVoiceScreenPanel
              entryId={entry.id}
              voiceProvider={voiceProvider}
              onProviderChange={setVoiceProvider}
              voice={voice}
              revokeNote={revokeNote}
              onRevoke={() => void revokeLinks()}
            />
          ) : null}

          {showLinks ? <PipelineSelfSchedulingPanel entryId={entry.id} sched={sched} /> : null}

          {error ? <p role="alert" className="rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

          {result ? <ResultView result={result} roleFamily={entry.roleFamily} /> : null}

          <PipelineDrawerFooterLinks candidateId={entry.candidateId} />
        </div>
      </aside>

      {/* The transcript modal, stacked over the drawer via the shared Modal portal +
          useDialogA11y stack (Escape closes the top-of-stack modal first, then the
          drawer). Adapted to the modal's SchedEntry prop shape WITHOUT touching the
          modal: it reads only id/candidateLabel/jobTitle, and fetches the session by
          entry id itself; approvalKind/approvalDetail are absent from the drawer's
          record and unused by the modal, so they degrade to null. */}
      {showTranscript ? (
        <InterviewTranscriptModal
          entry={
            {
              id: entry.id,
              candidateId: entry.candidateId,
              candidateLabel: entry.candidateLabel,
              archetype: entry.archetype,
              roleFamily: entry.roleFamily,
              jobId: entry.jobId,
              jobTitle: entry.jobTitle,
              stage: entry.stage,
              matchScore: entry.matchScore ?? null,
              status: entry.status,
              approvalKind: null,
              approvalDetail: null,
            } satisfies SchedEntry
          }
          onClose={() => setShowTranscript(false)}
        />
      ) : null}
    </div>
  );
}
