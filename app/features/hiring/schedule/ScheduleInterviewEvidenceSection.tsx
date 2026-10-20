"use client";

// The evidence half of the transcript modal (WP4): one fetch of the director's record
// for this session, then the observations panel, the audio players, and the transcript
// grouped under the agenda.
//
// IT DEGRADES TO TODAY'S MODAL. The record is an ENRICHMENT of a transcript that is
// already on screen, so a failed, empty or bounded evidence read must never cost the
// recruiter the conversation: every path below renders `TranscriptTurns`, and the only
// difference is whether it gets the agenda grouping. That is also why the fetch failure
// is a quiet line rather than a retry-or-nothing error state — the important content
// did not fail.

import { useMemo } from "react";
import type { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { InterviewEvidence } from "@/app/_lib/interview-evidence";
import type { VoiceTurn } from "@/app/_lib/voice/types";
import { alignTurnsToBlocks, groupTranscriptByBlock } from "./scheduleInterviewEvidence";
import { InterviewObservations } from "./ScheduleInterviewObservations";
import { InterviewRecordings } from "./ScheduleInterviewRecordings";
import { TranscriptTurns } from "./ScheduleInterviewTranscriptTurns";

export function InterviewEvidenceSection({
  sessionId,
  provider,
  transcript,
  citedTurns,
  highlightIdx,
  t,
}: {
  sessionId: string;
  provider?: string;
  transcript: VoiceTurn[];
  citedTurns: Set<number>;
  highlightIdx: number | null;
  t: ReturnType<typeof useTranslations<"scheduleTab.transcript">>;
}) {
  const { data, error, reload } = useJsonFetch<{ evidence?: InterviewEvidence }>(
    `/api/interview/sessions/${encodeURIComponent(sessionId)}/evidence`,
    t("evidence.loadFailed")
  );
  const evidence = data?.evidence ?? null;

  const anchors = useMemo(
    () => (evidence ? alignTurnsToBlocks(transcript, evidence.events) : null),
    [evidence, transcript]
  );
  const sections = useMemo(
    () => (anchors && evidence?.agenda ? groupTranscriptByBlock(anchors, evidence.agenda.blocks) : null),
    [anchors, evidence]
  );

  // A call from BEFORE the director left no record at all — no agenda, no events. That
  // is not "nothing was measured about this candidate"; it is an interview this product
  // never watched, and every one of them would otherwise carry a panel saying so. The
  // not-measured line is for a DIRECTED call whose signal is genuinely absent (a
  // provider that exposes no speech boundaries, a candidate who never left the tab).
  const directed = Boolean(evidence && (evidence.agenda || evidence.events.length > 0));

  return (
    <>
      {evidence && directed ? (
        <InterviewObservations
          events={evidence.events}
          blocks={evidence.agenda?.blocks ?? []}
          observed={evidence.observed}
          timingSource={evidence.timingSource}
        />
      ) : null}
      {evidence ? <InterviewRecordings sessionId={sessionId} recordings={evidence.recordings} onDeleted={reload} /> : null}
      {error ? <p className="text-sm text-steel">{error}</p> : null}
      {/* The record is bounded and says so. Past the bound the oldest turns simply lose
          their block tag and read as off-agenda — the transcript itself is whole. */}
      {evidence?.truncated ? <p className="text-sm text-steel">{t("evidence.truncated", { limit: evidence.limit })}</p> : null}
      <TranscriptTurns
        provider={provider}
        transcript={transcript}
        citedTurns={citedTurns}
        highlightIdx={highlightIdx}
        sections={sections ?? undefined}
        anchors={anchors ?? undefined}
        t={t}
      />
    </>
  );
}
