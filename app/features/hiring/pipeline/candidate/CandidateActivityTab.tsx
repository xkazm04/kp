"use client";

// Activity — what has HAPPENED to this candidate: the interview outcome (with its
// transcript), the recruiter's human scorecard and every message they were sent on
// one side; the merged history (pipeline events + analyses, interviews, invites,
// offers, rematch links) on the other. All of it rides the one-call bundle.

import { useTranslations } from "next-intl";
import { PipelineCommsList } from "../PipelineCommsList";
import { PipelineDrawerHistoryList } from "../PipelineDrawerHistoryList";
import { PipelineHumanScorecardCard } from "../PipelineHumanScorecardCard";
import { PipelineInterviewOutcomeCard } from "../PipelineInterviewOutcomeCard";
import type { CandidateState } from "./state/useCandidateState";

export function CandidateActivityTab({
  st,
  onOpenEntry,
}: {
  st: CandidateState;
  onOpenEntry: (entryId: string) => void;
}) {
  const t = useTranslations("pipeline.candidate");
  const hasComms = st.comms !== null && st.comms.length > 0;
  // `comms` is null until the bundle lands, so "nothing yet" is said only once it has.
  const nothingYet = st.comms !== null && !st.ivOutcome && !st.humanSc && !hasComms;

  return (
    <div className="grid gap-6 p-4 sm:p-6 md:grid-cols-2">
      <div className="min-w-0 space-y-4">
        {st.ivOutcome ? (
          <PipelineInterviewOutcomeCard ivOutcome={st.ivOutcome} onShowTranscript={() => st.setShowTranscript(true)} />
        ) : null}
        {st.humanSc ? <PipelineHumanScorecardCard humanSc={st.humanSc} /> : null}
        {/* W6-2 — what this candidate actually received, failed sends visible. */}
        {hasComms && st.comms ? <PipelineCommsList comms={st.comms} consentStatus={st.consent?.consent.status ?? null} onResent={st.onLetterResent} /> : null}
        {nothingYet ? <p className="text-sm text-steel">{t("activityEmpty")}</p> : null}
      </div>
      <div className="min-w-0 space-y-3">
        {/* single-entry-authz-parity — a refused bundle is named, not left blank. */}
        {st.timelineErr ? (
          <p role="alert" className="text-sm text-red-700">
            {st.timelineErr}
          </p>
        ) : null}
        <PipelineDrawerHistoryList
          mergedHistory={st.mergedHistory}
          rematchLinks={st.rematchLinks}
          onOpenEntry={onOpenEntry}
        />
      </div>
    </div>
  );
}
