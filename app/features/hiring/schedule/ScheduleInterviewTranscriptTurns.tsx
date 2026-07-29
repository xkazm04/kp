"use client";

// The turn-by-turn transcript list of the transcript modal, with cited-turn
// markers (VOX3) and the currently jumped-to turn highlighted. Split out of
// ScheduleInterviewTranscriptModal.tsx to keep the modal file under the
// 200-line cap.

import type { useTranslations } from "next-intl";
import type { VoiceTurn } from "@/app/_lib/voice/types";

export function TranscriptTurns({
  provider,
  transcript,
  citedTurns,
  highlightIdx,
  t,
}: {
  provider?: string;
  transcript: VoiceTurn[];
  citedTurns: Set<number>;
  highlightIdx: number | null;
  t: ReturnType<typeof useTranslations<"scheduleTab.transcript">>;
}) {
  return (
    <section>
      <p className="text-meta uppercase tracking-wide text-steel">
        {t("transcriptHeading")} {provider ? `· ${provider}` : ""}
      </p>
      {transcript.length === 0 ? (
        <p className="mt-2 text-sm text-steel">{t("noTranscript")}</p>
      ) : (
        <div className="mt-2 space-y-2.5">
          {transcript.map((turn, i) => {
            const highlighted = highlightIdx === i;
            return (
              <div key={i} id={`iv-turn-${i}`} className={turn.role === "candidate" ? "text-right" : ""}>
                <p className="text-meta uppercase text-steel">
                  {turn.role === "candidate" ? t("roleCandidate") : turn.role === "interviewer" ? t("roleInterviewer") : t("roleSystem")}
                  {citedTurns.has(i) ? <span className="ml-1.5 text-coral" title={t("citedTitle")}>{t("cited")}</span> : null}
                </p>
                <p
                  className={`mt-0.5 inline-block max-w-[85%] rounded-lg px-3 py-2 text-base leading-6 transition-shadow ${
                    turn.role === "candidate" ? "bg-limewash text-ink" : "bg-paper text-ink"
                  } ${highlighted ? "ring-2 ring-coral" : ""}`}
                >
                  {turn.text}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
