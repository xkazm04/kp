"use client";

// The turn-by-turn transcript list of the transcript modal, with cited-turn
// markers (VOX3) and the currently jumped-to turn highlighted. Split out of
// ScheduleInterviewTranscriptModal.tsx to keep the modal file under the
// 200-line cap.
//
// WP4 — the list now reads as the interview's AGENDA when the director left a record:
// each stretch of turns sits under the block that was live when it was spoken, with
// that block's budget, whether it was covered, and whether it is scored at all. The
// grouping is a pure function next door (scheduleInterviewEvidence.ts) and it CONSERVES
// turns: a turn the director never saw still renders, in an off-agenda run, in place.
// Turn indices are untouched, so the scorecard's quote→turn jump keeps working exactly
// as it did.

import type { useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import type { VoiceTurn } from "@/app/_lib/voice/types";
import { clockLabel, type TranscriptSection, type TurnAnchor } from "./scheduleInterviewEvidence";

type T = ReturnType<typeof useTranslations<"scheduleTab.transcript">>;

function Turn({
  turn,
  i,
  cited,
  highlighted,
  at,
  t,
}: {
  turn: VoiceTurn;
  i: number;
  cited: boolean;
  highlighted: boolean;
  at: string | null;
  t: T;
}) {
  return (
    <div id={`iv-turn-${i}`} className={turn.role === "candidate" ? "text-right" : ""}>
      <p className={META_LABEL}>
        {turn.role === "candidate" ? t("roleCandidate") : turn.role === "interviewer" ? t("roleInterviewer") : t("roleSystem")}
        {at ? (
          <span className="ml-1.5 nums normal-case" title={t("evidence.atTime", { time: at })}>
            {at}
          </span>
        ) : null}
        {cited ? (
          <span className="ml-1.5 text-coral" title={t("citedTitle")}>
            {t("cited")}
          </span>
        ) : null}
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
}

export function TranscriptTurns({
  provider,
  transcript,
  citedTurns,
  highlightIdx,
  sections,
  anchors,
  t,
}: {
  provider?: string;
  transcript: VoiceTurn[];
  citedTurns: Set<number>;
  highlightIdx: number | null;
  /** The agenda grouping, when the call left a director record. Absent ⇒ the flat
   *  list this modal has always rendered. */
  sections?: TranscriptSection[];
  anchors?: TurnAnchor[];
  t: T;
}) {
  const renderTurn = (i: number) => {
    const turn = transcript[i];
    if (!turn) return null;
    return (
      <Turn
        key={i}
        turn={turn}
        i={i}
        cited={citedTurns.has(i)}
        highlighted={highlightIdx === i}
        at={clockLabel(anchors?.[i]?.offsetMs ?? null)}
        t={t}
      />
    );
  };

  return (
    <section>
      <p className={`${META_LABEL} tracking-wide`}>
        {t("transcriptHeading")} {provider ? `· ${provider}` : ""}
      </p>
      {transcript.length === 0 ? (
        <p className="mt-2 text-sm text-steel">{t("noTranscript")}</p>
      ) : sections && sections.length > 0 ? (
        <div className="mt-2 space-y-4">
          {sections.map((section, si) => (
            <div key={si}>
              {section.kind === "block" ? (
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-2 border-coral/40 pl-2">
                  <span className="text-sm font-semibold text-ink">{section.block.title}</span>
                  <span className="nums text-meta text-steel">{t("evidence.budget", { min: section.block.budgetMin })}</span>
                  <span className={`text-meta uppercase ${section.block.covered ? "text-moss" : "text-steel"}`}>
                    {section.block.covered ? t("evidence.covered") : t("evidence.notCovered")}
                  </span>
                  {section.block.scored ? null : (
                    <span className={META_LABEL} title={t("evidence.notAssessedTitle")}>
                      · {t("evidence.notAssessedBlock")}
                    </span>
                  )}
                </div>
              ) : (
                <p className={`${META_LABEL} pl-2`}>{t("evidence.offAgenda")}</p>
              )}
              {section.turns.length === 0 ? (
                <p className="mt-1.5 pl-2 text-sm text-steel">{t("evidence.noTurns")}</p>
              ) : (
                <div className="mt-1.5 space-y-2.5">{section.turns.map(renderTurn)}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 space-y-2.5">{transcript.map((_, i) => renderTurn(i))}</div>
      )}
    </section>
  );
}
