"use client";

import { ClipboardCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { rubricLabel, RUBRIC_CS } from "@/app/_lib/interview-rubric";
import type { InterviewTelemetry } from "@/app/_lib/interview-telemetry";
import { talkSharePercent, formatSpokenDuration } from "@/app/_lib/voice/telemetry-format";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { mergeRubricRows, isUnrecognizedCohort, type RubricComp } from "./jobsCompareCohorts";
import { CONF_STYLE, REC_STYLE, ratingColor, type Candidate } from "./jobsCompareInterviewsTypes";

// One candidate's call telemetry as a compact, neutral signal line under the
// verdict badges — talk share, longest pause, and (when scripted) hint response.
// DESCRIPTIVE only: steel text, no red/green judgment coloring. Renders nothing
// when telemetry is absent or every field is null (a human-led / legacy round).
function TelemetrySignals({
  telemetry,
  t,
}: {
  telemetry: InterviewTelemetry | null;
  t: ReturnType<typeof useTranslations<"jobs.compare">>;
}) {
  if (!telemetry) return null;
  const talk = talkSharePercent(telemetry);
  const pause = formatSpokenDuration(telemetry.longestResponseGapSec);
  const hintKey =
    telemetry.hint.offered && telemetry.hint.uptake !== "not_offered"
      ? (
          { integrated: "telemetryHintIntegrated", acknowledged: "telemetryHintAcknowledged", missed: "telemetryHintMissed" } as const
        )[telemetry.hint.uptake]
      : null;

  const parts: string[] = [];
  if (talk !== null) parts.push(t("telemetryTalk", { pct: talk }));
  if (pause) parts.push(t("telemetryPause", { dur: pause }));
  if (hintKey) parts.push(t(hintKey));
  if (parts.length === 0) return null;

  return (
    <span className="mt-1 block text-meta text-steel nums" title={t("telemetryTitle")}>
      {parts.join(" · ")}
    </span>
  );
}

export function CohortTable({ rubric, candidates }: { rubric: RubricComp[]; candidates: Candidate[] }) {
  const t = useTranslations("jobs.compare");
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  const ratingOf = (c: Candidate, comp: string) =>
    c.ratings.find((r) => r.competency.toLowerCase() === comp.toLowerCase());
  const confLabel = (lvl: string) => {
    const key = `confidence.${lvl}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : lvl;
  };

  // interview-simulation-comparison #1/#2 — render the union of the cohort's
  // rubric axes and any competency a candidate was actually scored on that the
  // current rubric doesn't contain (rubric-version drift / off-taxonomy model),
  // flagged so a real score is never silently blanked to "—".
  const rows = mergeRubricRows(rubric, candidates);
  const unrecognized = isUnrecognizedCohort(rubric);

  return (
    <div className="mt-3 overflow-x-auto">
      {/* interview-simulation-comparison #1 — an off-taxonomy scoringModel maps to
          no rubric; say so instead of showing a header above an empty body. */}
      {unrecognized ? (
        <p className="mb-2 rounded-md bg-dial-amber/15 px-2.5 py-1.5 text-sm text-ink">{t("unrecognizedRubric")}</p>
      ) : null}
      <table className="w-full border-collapse text-base">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white p-2 text-left text-meta uppercase text-steel">{t("competency")}</th>
            {candidates.map((c, i) => (
              <th key={i} className="min-w-[140px] p-2 text-left align-bottom">
                <p className="font-medium text-ink">{c.candidateLabel}</p>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  {c.recommendation ? (
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-meta font-semibold uppercase ${
                        REC_STYLE[c.recommendation] ?? "bg-stone-100 text-steel"
                      }`}
                    >
                      {enumLabel("recommendation", c.recommendation)}
                    </span>
                  ) : null}
                  {c.confidence ? (
                    <span
                      className={`text-meta ${CONF_STYLE[c.confidence.level] ?? "text-steel"}`}
                      title={c.confidence.reason || ""}
                    >
                      {confLabel(c.confidence.level)}
                    </span>
                  ) : null}
                  {c.observedSkills.length > 0 ? (
                    <span
                      className="inline-block rounded-full bg-moss/15 px-2 py-0.5 text-meta font-semibold text-moss"
                      title={t("observedTitle")}
                    >
                      {t("observedLabel", { skills: c.observedSkills.join(", ") })}
                    </span>
                  ) : null}
                  {c.humanScorecard?.recommendation ? (
                    // The verdict from a recruiter's human round, distinct from the
                    // AI badge above (icon + "human" so the two never read as one).
                    <span
                      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-meta font-semibold uppercase ${
                        REC_STYLE[c.humanScorecard.recommendation] ?? "bg-stone-100 text-steel"
                      }`}
                      title={t("humanVerdictTitle")}
                    >
                      <ClipboardCheck size={11} /> {t("humanVerdict", { rec: enumLabel("recommendation", c.humanScorecard.recommendation) })}
                    </span>
                  ) : null}
                  {c.humanOnly ? (
                    <span
                      className="inline-block rounded-full bg-stone-100 px-2 py-0.5 text-meta font-semibold uppercase text-steel"
                      title={t("humanOnlyTitle")}
                    >
                      {t("humanOnly")}
                    </span>
                  ) : null}
                </span>
                {/* Descriptive conversational-dynamics signals (not scores): neutral,
                    scannable, no verdict coloring. Hidden when telemetry is absent. */}
                <TelemetrySignals telemetry={c.telemetry ?? null} t={t} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((comp) => (
            <tr key={comp.competency} className="border-t border-stone-100">
              {/* PREP3 — localized display; the match on r.competency stays canonical. */}
              <td className="sticky left-0 bg-white p-2 text-ink" title={(locale === "cs" ? RUBRIC_CS[comp.competency]?.description : undefined) ?? comp.description}>
                {rubricLabel(comp.competency, locale)}
                {/* interview-simulation-comparison #2 — this axis isn't in the cohort's
                    current rubric; the candidate was scored on a different/older axis set. */}
                {comp.offRubric ? (
                  <span className="ml-1.5 text-meta uppercase text-steel" title={t("offRubricTitle")}>
                    · {t("offRubric")}
                  </span>
                ) : null}
              </td>
              {candidates.map((c, i) => {
                const r = ratingOf(c, comp.competency);
                return (
                  <td key={i} className="p-2">
                    {r ? (
                      <span
                        className={`inline-flex h-7 w-9 items-center justify-center rounded-md font-semibold nums ${ratingColor(
                          r.rating
                        )}`}
                        title={r.evidence || ""}
                      >
                        {r.rating}
                      </span>
                    ) : (
                      <span className="text-steel">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
