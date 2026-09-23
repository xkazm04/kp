"use client";

import { ClipboardCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { rubricLabel, rubricDescription } from "@/app/_lib/interview-rubric";
import { useRubricStrings } from "@/app/_lib/use-rubric-strings";
import { isNotAssessedRating } from "@/app/_lib/interview-scorecard";
import type { InterviewTelemetry } from "@/app/_lib/interview-telemetry";
import { talkSharePercent, formatSpokenDuration } from "@/app/_lib/voice/telemetry-format";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import {
  cellFlag,
  coverageFor,
  mergeRubricRows,
  mustAsksOwed,
  isUnrecognizedCohort,
  type CoverageCellFlag,
  type RubricComp,
} from "./jobsCompareCohorts";
import type { AxisCoverageState } from "@/app/_lib/interview-axis-coverage";
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
  // Parts, not a formatted string: the unit letters live in the 4 catalogs.
  const pauseParts = formatSpokenDuration(telemetry.longestResponseGapSec);
  const pause = pauseParts ? t("duration", pauseParts) : null;
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

// The director's record for one AI cell (challenge-r07 voice-interview-api/B): a
// small state glyph — covered on a verified quote, only asked, never reached — and,
// where the AI rating and that record DISAGREE, a flag naming the disagreement. The
// glyph shapes differ (filled / half / hollow) so the state never rests on colour.
const COVERAGE_GLYPH: Record<Exclude<AxisCoverageState, "not_planned">, { glyph: string; cls: string; key: "covered" | "asked" | "notReached" }> = {
  covered: { glyph: "●", cls: "text-moss", key: "covered" },
  asked: { glyph: "◐", cls: "text-steel", key: "asked" },
  not_reached: { glyph: "○", cls: "text-coral", key: "notReached" },
};
const FLAG_STYLE: Record<CoverageCellFlag, { cls: string; key: "ratedNotReached" | "sentinelCovered" }> = {
  rated_not_reached: { cls: "bg-coral/10 text-coral", key: "ratedNotReached" },
  sentinel_but_covered: { cls: "bg-dial-amber/15 text-ink", key: "sentinelCovered" },
};

function CoverageMark({
  state,
  flag,
  t,
}: {
  state: AxisCoverageState | undefined;
  flag: CoverageCellFlag | null;
  t: ReturnType<typeof useTranslations<"jobs.compare">>;
}) {
  const g = state && state !== "not_planned" ? COVERAGE_GLYPH[state] : null;
  if (!g && !flag) return null;
  return (
    <>
      {g ? (
        <span className={`ml-1.5 text-meta ${g.cls}`} title={t(`coverage.${g.key}Title`)} aria-label={t(`coverage.${g.key}`)}>
          {g.glyph}
        </span>
      ) : null}
      {flag ? (
        <span
          className={`mt-1 block w-fit rounded-full px-2 py-0.5 text-meta font-semibold ${FLAG_STYLE[flag].cls}`}
          title={t(`coverage.${FLAG_STYLE[flag].key}Title`)}
        >
          {t(`coverage.${FLAG_STYLE[flag].key}`)}
        </span>
      ) : null}
    </>
  );
}

export function CohortTable({ rubric, candidates }: { rubric: RubricComp[]; candidates: Candidate[] }) {
  const t = useTranslations("jobs.compare");
  const rubricStrings = useRubricStrings();
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
            <th scope="col" className="sticky left-0 bg-white p-2 text-left text-meta uppercase text-steel">{t("competency")}</th>
            {candidates.map((c, i) => (
              <th key={i} scope="col" className="min-w-[140px] p-2 text-left align-bottom">
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
                  {(c.humanScorecards ?? []).map((h, j) =>
                    h.recommendation ? (
                      // One verdict per interviewer + round from the human panel,
                      // distinct from the AI badge above (icon + "human" so the two
                      // never read as one). The title names whose verdict it is.
                      <span
                        key={`h-${j}`}
                        className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-meta font-semibold uppercase ${
                          REC_STYLE[h.recommendation] ?? "bg-stone-100 text-steel"
                        }`}
                        title={[t("humanVerdictTitle"), h.authorLabel, h.stage].filter(Boolean).join(" · ")}
                      >
                        <ClipboardCheck size={11} /> {t("humanVerdict", { rec: enumLabel("recommendation", h.recommendation) })}
                      </span>
                    ) : null
                  )}
                  {mustAsksOwed(c.coverage) !== null ? (
                    // A count only: the question texts are the recruiter's kit, not
                    // this door's to repeat. Null (no end_interview) renders nothing.
                    <span
                      className="inline-block rounded-full bg-coral/10 px-2 py-0.5 text-meta font-semibold text-coral"
                      title={t("coverage.mustAsksOwedTitle")}
                    >
                      {t("coverage.mustAsksOwed", { count: mustAsksOwed(c.coverage) ?? 0 })}
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
              <td className="sticky left-0 bg-white p-2 text-ink" title={rubricDescription(comp.competency, comp.description, rubricStrings)}>
                {rubricLabel(comp.competency, rubricStrings)}
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
                // NOT-ASSESSED IS ON THE SCALE. The synthesis writes an axis the
                // interview never reached as a real 3 with "Not assessed…" evidence —
                // which this grid coloured as a mid-band score and ranked candidates
                // against. It is the comparison surface, so the confusion is worst
                // here: a candidate asked about an axis and one never asked about it
                // rendered identically. The shared read-side guard says which is which.
                const notAssessed = r ? isNotAssessedRating(r.rating, r.evidence) : false;
                // The director's record for this axis, and whether the rating disagrees.
                const state = coverageFor(c.coverage, comp.competency);
                const flag = cellFlag(r?.rating, r?.evidence, state);
                return (
                  <td key={i} className="p-2">
                    {r && !notAssessed ? (
                      <span
                        className={`inline-flex h-7 w-9 items-center justify-center rounded-md font-semibold nums ${ratingColor(
                          r.rating
                        )}`}
                        title={r.evidence || ""}
                      >
                        {r.rating}
                      </span>
                    ) : notAssessed ? (
                      <span className={META_LABEL} title={t("notAssessedTitle")}>
                        {t("notAssessed")}
                      </span>
                    ) : (
                      <span className="text-steel">—</span>
                    )}
                    <CoverageMark state={state} flag={flag} t={t} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {candidates.some((c) => c.coverage) ? (
        <p className="mt-2 text-meta text-steel">
          {t("coverage.legend")}{" "}
          {(["covered", "asked", "not_reached"] as const).map((s) => (
            <span key={s} className="mr-2 whitespace-nowrap">
              <span className={COVERAGE_GLYPH[s].cls}>{COVERAGE_GLYPH[s].glyph}</span> {t(`coverage.${COVERAGE_GLYPH[s].key}`)}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
