"use client";

// The AI voice-screen scorecard section of the transcript modal: provenance
// badge, honest coverage caveat, per-competency ratings (each evidence quote
// clickable to jump to its transcript turn), the read-back entities strip and
// the telemetry strip. Split out of ScheduleInterviewTranscriptModal.tsx to
// keep the modal file under the 200-line cap.

import { Quote } from "lucide-react";
import { useLocale, type useTranslations } from "next-intl";
import { Badge, interviewRecommendationToken } from "@/app/_components/Badge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ReadbackEntitiesStrip } from "@/app/_components/results/interview/ReadbackEntitiesStrip";
import type { Scorecard, ScorecardEntities } from "@/app/_lib/interview-scorecard";
import type { InterviewTelemetry } from "@/app/_lib/interview-telemetry";
import type { ScorecardCoverage } from "@/app/_lib/interview-transcript";
import { ScorecardRatingRow } from "./ScheduleInterviewScorecardRow";
import { InterviewTelemetryStrip } from "./ScheduleInterviewTelemetryStrip";

export function AiScorecardSection({
  sc,
  coverage,
  entities,
  telemetry,
  evidenceTurns,
  jumpToTurn,
  t,
}: {
  sc: Scorecard;
  coverage: ScorecardCoverage | null;
  entities: ScorecardEntities | null;
  telemetry: InterviewTelemetry | null;
  evidenceTurns: number[];
  jumpToTurn: (idx: number) => void;
  t: ReturnType<typeof useTranslations<"scheduleTab.transcript">>;
}) {
  const enumLabel = useEnumLabel();
  const locale = useLocale();
  // Honest narrative language, exactly as MatchReasoningPanel states it for the
  // match rationale. The summary + recommendation rationale follow the requested
  // --lang on the LLM path, but the deterministic template is English whatever was
  // asked for — so a cs/de/fr recruiter was shown English prose inside localized
  // chrome with nothing saying so. The scorecard stamps `narrativeLang`
  // (automation.py, scorecard-v7); it rides the stored scorecard object rather than
  // the pure Scorecard type, like `telemetry` and `coverage`, so it is narrowed here
  // and a legacy row (no stamp) shows nothing — the pre-v7 behaviour exactly.
  const narrativeLang = (sc as { narrativeLang?: unknown }).narrativeLang;
  const narrativeLangName =
    typeof narrativeLang === "string" && narrativeLang && narrativeLang !== locale
      ? (new Intl.DisplayNames([locale], { type: "language" }).of(narrativeLang) ?? narrativeLang)
      : null;
  return (
    <section className="rounded-md border border-stone-200 bg-paper p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-meta uppercase tracking-wide text-steel">{t("aiScorecard")}</p>
        {sc.recommendation ? (
          <Badge
            {...interviewRecommendationToken(sc.recommendation)}
            label={enumLabel("recommendation", sc.recommendation)}
            ariaLabel={t("recommendationAria", { label: enumLabel("recommendation", sc.recommendation) })}
          />
        ) : null}
      </div>
      {/* Honest coverage caveat — shown only when head+tail sampling meant the
          scorer read less than the full transcript; nothing when complete. */}
      {coverage ? (
        <p className="mt-2 rounded-md bg-dial-amber/15 px-2.5 py-1.5 text-sm text-ink">
          {t("coverageCaveat", { kept: coverage.keptTurns, total: coverage.totalTurns })}
        </p>
      ) : null}
      {narrativeLangName ? (
        <p className="mt-1.5 text-sm italic text-steel">
          {t("narrativeInLanguage", { language: narrativeLangName })}
        </p>
      ) : null}
      {sc.summary ? <p className="mt-1.5 text-base text-ink">{sc.summary}</p> : null}
      {sc.ratings && sc.ratings.length ? (
        <ul className="mt-2.5 space-y-2.5">
          {sc.ratings.map((r, i) => (
            <ScorecardRatingRow
              key={i}
              r={r}
              t={t}
              renderEvidence={(evidence) =>
                evidenceTurns[i] >= 0 ? (
                  // Clickable: jump to the transcript turn this quote came
                  // from — "verify the AI in one click" at the Offer gate.
                  <button
                    type="button"
                    onClick={() => jumpToTurn(evidenceTurns[i])}
                    className="focus-ring mt-1 inline-flex items-start gap-1 rounded text-left text-meta text-steel hover:text-coral"
                    title={t("jumpToMoment")}
                  >
                    <Quote size={11} className="mt-0.5 shrink-0 text-coral/70" aria-hidden />
                    <span className="underline decoration-dotted underline-offset-2">{evidence}</span>
                  </button>
                ) : (
                  <p className="mt-1 text-meta text-steel">{evidence}</p>
                )
              }
            />
          ))}
        </ul>
      ) : null}
      {entities ? <ReadbackEntitiesStrip entities={entities} t={t} /> : null}
      {telemetry ? <InterviewTelemetryStrip telemetry={telemetry} t={t} /> : null}
      <p className="mt-2 text-meta text-steel">{t("feedsReview")}</p>
    </section>
  );
}
