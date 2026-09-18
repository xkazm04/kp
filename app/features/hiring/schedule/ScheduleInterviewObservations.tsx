"use client";

// OBSERVATIONS from a directed AI interview — the panel under the scorecard.
//
// Read the heading before the code: these are observations, they are not scored, and
// they are never a reason the product gives to reject a candidate (registry:
// observed-process-is-supporting-not-load-bearing, never-infer-from-how-a-person-
// sounds). That is why there is no total, no band, no tone: every number here is
// neutral ink, and the panel says what it is in words as well as in styling.
//
// Two honesty rules the markup enforces:
//   1. A signal that was NOT MEASURED says so. `observed: false` (the call left no
//      director record at all) turns the whole panel into one line saying nothing was
//      observed — never four rows of zeroes, which read as findings.
//   2. ANSWER TIMING NAMES ITS INSTRUMENT. OpenAI measures from transcription speech
//      boundaries, ElevenLabs from voice-activity windows with hysteresis. They are
//      not the same quantity, so the panel says which one produced these numbers and
//      says they compare only inside this call.

import { useTranslations } from "next-intl";
import { META_LABEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { formatSpokenDuration } from "@/app/_lib/voice/telemetry-format";
import type { EvidenceBlock, EvidenceEvent, EvidenceTimingSource } from "@/app/_lib/interview-evidence";
import { summarizeAnswerTiming, summarizeFocus } from "./scheduleInterviewEvidence";

/** Guardrail kinds → their catalog key. A literal union, so a new kind in the
 *  vocabulary is a compile error here rather than a blank chip. */
const GUARDRAIL_KEY = {
  score_request: "evidence.guardScoreRequest",
  instruction_override: "evidence.guardInstructionOverride",
  prompt_disclosure: "evidence.guardPromptDisclosure",
  off_topic: "evidence.guardOffTopic",
} as const;

const TIMING_SOURCE_KEY: Record<EvidenceTimingSource, "evidence.timingSpeechBoundaries" | "evidence.timingVadWindows"> = {
  speech_boundaries: "evidence.timingSpeechBoundaries",
  vad_windows: "evidence.timingVadWindows",
};

const FOCUS_DURING_KEY = {
  interviewer: "evidence.focusDuringInterviewer",
  candidate: "evidence.focusDuringCandidate",
  idle: "evidence.focusDuringIdle",
} as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-stone-200 pt-2.5 first:border-t-0 first:pt-0">
      <p className={META_LABEL}>{label}</p>
      <div className="mt-1 space-y-1 text-sm text-ink">{children}</div>
    </div>
  );
}

export function InterviewObservations({
  events,
  blocks,
  observed,
  timingSource,
}: {
  events: EvidenceEvent[];
  blocks: EvidenceBlock[];
  observed: boolean;
  timingSource: EvidenceTimingSource | null;
}) {
  const t = useTranslations("scheduleTab.transcript");
  const blockTitle = (id: string | null) => blocks.find((b) => b.id === id)?.title ?? t("evidence.offAgenda");
  // Parts, not a formatted string: the unit letters live in the 4 catalogs.
  const dur = (ms: number | null) => {
    const parts = formatSpokenDuration(ms === null ? null : ms / 1000);
    return parts ? t("duration", parts) : null;
  };

  const focus = summarizeFocus(events);
  const timing = summarizeAnswerTiming(events);
  const guardrails = events.filter((e) => e.kind === "guardrail");
  const questions = events.filter((e) => e.kind === "candidate_question");

  return (
    <section className={`${PANEL_SUNKEN} p-3`}>
      <p className={`${META_LABEL} tracking-wide`}>{t("evidence.observationsHeading")}</p>
      <p className="mt-1 text-sm text-steel">{t("evidence.observationsNote")}</p>

      {!observed ? (
        <p className="mt-2.5 text-sm text-steel">{t("evidence.notObserved")}</p>
      ) : (
        <div className="mt-3 space-y-2.5">
          {/* Focus — count, total away time, and which block each departure fell in.
              A departure whose length the browser could not measure is COUNTED and
              named as unmeasured; it never contributes a 0 to the total. */}
          <Row label={t("evidence.focusHeading")}>
            {focus.departures.length === 0 ? (
              <p className="text-steel">{t("evidence.focusNone")}</p>
            ) : (
              <>
                <p className="nums">
                  {t("evidence.focusCount", { count: focus.departures.length })}
                  {focus.totalAwayMs !== null ? ` · ${t("evidence.focusTotal", { dur: dur(focus.totalAwayMs) ?? "" })}` : ""}
                </p>
                {focus.unmeasured > 0 ? (
                  <p className="text-steel">{t("evidence.focusUnmeasured", { count: focus.unmeasured })}</p>
                ) : null}
                <ul className="space-y-0.5 text-steel">
                  {focus.departures.map((d, i) => (
                    <li key={i}>
                      {blockTitle(d.blockId)}
                      {d.during && d.during in FOCUS_DURING_KEY
                        ? ` · ${t(FOCUS_DURING_KEY[d.during as keyof typeof FOCUS_DURING_KEY])}`
                        : ""}
                      {" · "}
                      <span className="nums">{d.awayMs !== null ? dur(d.awayMs) : t("evidence.notMeasured")}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Row>

          {/* Guardrails — the candidate's own words, and what the interviewer did
              about them. The interviewer's move is the SAME every time (decline in one
              sentence, continue), which is exactly why it is stated: a recruiter
              reading a quote must see that nothing was withheld or penalised. */}
          <Row label={t("evidence.guardHeading")}>
            {guardrails.length === 0 ? (
              <p className="text-steel">{t("evidence.guardNone")}</p>
            ) : (
              <ul className="space-y-1.5">
                {guardrails.map((g, i) => (
                  <li key={i}>
                    <p className="text-steel">
                      {g.guardrail && g.guardrail in GUARDRAIL_KEY
                        ? t(GUARDRAIL_KEY[g.guardrail as keyof typeof GUARDRAIL_KEY])
                        : t("evidence.guardOther")}
                      {" · "}
                      {blockTitle(g.blockId)}
                    </p>
                    {g.quote ? <p className="italic">“{g.quote}”</p> : null}
                    <p className="text-steel">
                      {t("evidence.guardAction")}
                      {g.verified === false ? ` · ${t("evidence.guardUnverified")}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Row>

          {/* Answer timing — per block, with the instrument named. */}
          <Row label={t("evidence.timingHeading")}>
            {timing.length === 0 ? (
              <p className="text-steel">{t("evidence.timingNone")}</p>
            ) : (
              <>
                <ul className="space-y-0.5">
                  {timing.map((row, i) => (
                    <li key={i}>
                      <span className="font-semibold">{blockTitle(row.blockId)}</span>{" "}
                      <span className="nums text-steel">
                        {t("evidence.timingAnswers", { count: row.answers })}
                        {" · "}
                        {t("evidence.timingPause")}: {row.preSilenceMs !== null ? dur(row.preSilenceMs) : t("evidence.notMeasured")}
                        {" · "}
                        {t("evidence.timingLength")}: {row.durationMs !== null ? dur(row.durationMs) : t("evidence.notMeasured")}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-steel">
                  {timingSource
                    ? t("evidence.timingSourceNote", { how: t(TIMING_SOURCE_KEY[timingSource]) })
                    : t("evidence.timingSourceUnknown")}
                </p>
              </>
            )}
          </Row>

          {/* Forwarded questions — the one part of this panel a recruiter can ACT on:
              the interviewer told the candidate someone would follow up. */}
          <Row label={t("evidence.questionsHeading")}>
            {questions.length === 0 ? (
              <p className="text-steel">{t("evidence.questionsNone")}</p>
            ) : (
              <>
                <ul className="list-disc space-y-0.5 pl-4">
                  {questions.map((q, i) => (
                    <li key={i}>{q.question ?? t("evidence.questionWithheld")}</li>
                  ))}
                </ul>
                <p className="text-steel">{t("evidence.questionsNote")}</p>
              </>
            )}
          </Row>
        </div>
      )}
    </section>
  );
}
