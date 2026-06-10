"use client";

import { Scale, ClipboardCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { InterviewRecommendation } from "@/app/_lib/interview-recommendation";
import type { Scorecard, ScorecardRating } from "@/app/_lib/interview-scorecard";
import { EmptyState } from "./JobsShared";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

type Candidate = {
  entryId: string | null;
  candidateLabel: string | null;
  recommendation: InterviewRecommendation | null;
  summary: string | null;
  scoringModel: string;
  confidence: { level: string; reason?: string } | null;
  ratings: ScorecardRating[];
  // Skills this interview minted as observed-provenance evidence (the
  // case-grounded gates) — the highest-trust artifact, stamped visibly below.
  observedSkills: string[];
  // A recruiter's human scorecard for this candidate (PREP1), if one was filled —
  // shown beside the AI screen so a human-led round isn't invisible here.
  humanScorecard?: Scorecard | null;
  // True for a candidate whose round was HUMAN-led (human scorecard, no voice
  // session) — their blank AI ratings mean "not AI-interviewed", not "synthesis
  // failed", and the chip below says so.
  humanOnly?: boolean;
};
type RubricComp = { competency: string; description: string; anchors?: Record<string, string> };

// Candidates are comparable WITHIN a cohort, not across — an experienced hire's
// track-record axes and a student's potential constructs are different rubrics.
// Cohort display labels live in the catalog (jobs.compare.cohort.*).
const COHORT_ORDER = ["experienced", "early_career"];

// Keyed by the InterviewRecommendation union so every canonical verdict is
// styled (a new verdict in the contract is a compile error here until handled).
const REC_STYLE: Record<InterviewRecommendation, string> = {
  advance: "bg-moss/15 text-moss",
  hold: "bg-dial-amber/20 text-ink",
  reject: "bg-coral/10 text-coral",
};
const CONF_STYLE: Record<string, string> = {
  tight: "text-moss",
  moderate: "text-steel",
  wide: "text-dial-amber",
};
const ratingColor = (r: number) =>
  r >= 4 ? "bg-moss/15 text-moss" : r <= 2 ? "bg-coral/10 text-coral" : "bg-stone-100 text-ink";

function CohortTable({ rubric, candidates }: { rubric: RubricComp[]; candidates: Candidate[] }) {
  const t = useTranslations("jobs.compare");
  const enumLabel = useEnumLabel();
  const ratingOf = (c: Candidate, comp: string) =>
    c.ratings.find((r) => r.competency.toLowerCase() === comp.toLowerCase());
  const confLabel = (lvl: string) => {
    const key = `confidence.${lvl}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : lvl;
  };

  return (
    <div className="mt-3 overflow-x-auto">
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
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rubric.map((comp) => (
            <tr key={comp.competency} className="border-t border-stone-100">
              <td className="sticky left-0 bg-white p-2 text-ink" title={comp.description}>
                {comp.competency}
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

export function CompareInterviews({ jobId }: { jobId: string }) {
  const t = useTranslations("jobs.compare");
  const { data, error } = useJsonFetch<{ rubrics: Record<string, RubricComp[]>; candidates: Candidate[] }>(
    `/api/interview/compare?job=${encodeURIComponent(jobId)}`,
    t("loadFailed")
  );
  const cohortLabel = (model: string) => {
    const key = `cohort.${model}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : model;
  };

  if (error) return <p className="text-base text-coral">{error}</p>;
  if (!data) return <p className="text-base text-steel">{t("loading")}</p>;
  if (data.candidates.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title={t("emptyTitle")}
        body={t("emptyBody")}
      />
    );
  }

  // Group by the candidate's scoringModel; render a table per non-empty cohort
  // against that cohort's rubric. Known cohorts come first, then any others.
  const present = Array.from(new Set(data.candidates.map((c) => c.scoringModel || "experienced")));
  const models = [
    ...COHORT_ORDER.filter((m) => present.includes(m)),
    ...present.filter((m) => !COHORT_ORDER.includes(m)),
  ];
  const cohorts = models.map((model) => ({
    model,
    rubric: data.rubrics[model] ?? [],
    candidates: data.candidates.filter((c) => (c.scoringModel || "experienced") === model),
  }));

  return (
    <div>
      <p className="text-base text-steel">
        {cohorts.length > 1 ? t("multiCohortNote") : t("singleCohortNote")}
      </p>

      {cohorts.map((g) => (
        <div key={g.model} className="mt-4">
          {cohorts.length > 1 ? (
            <p className="text-meta uppercase tracking-wide text-steel">{cohortLabel(g.model)}</p>
          ) : null}
          <CohortTable rubric={g.rubric} candidates={g.candidates} />
        </div>
      ))}

      <p className="mt-5 text-meta uppercase text-steel">{t("evidenceHeading")}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {data.candidates.map((c, i) => (
          <div key={i} className="rounded-md border border-stone-200 bg-paper/40 p-3">
            <p className="font-medium text-ink">{c.candidateLabel}</p>
            {c.summary ? <p className="mt-0.5 text-sm text-steel">{c.summary}</p> : null}
            <ul className="mt-2 space-y-1">
              {/* Every evidenced rating, visibly — the quotes ARE the scorecard's
                  accountability, so they must not hide behind hover tooltips. */}
              {c.ratings
                .filter((r) => r.evidence && r.evidence !== "Not assessed.")
                .map((r, j) => (
                  <li key={j} className="flex items-baseline gap-1.5 text-sm text-ink">
                    <span
                      className={`inline-flex h-5 w-6 shrink-0 items-center justify-center rounded font-semibold nums ${ratingColor(
                        r.rating
                      )}`}
                    >
                      {r.rating}
                    </span>
                    <span>
                      <span className="font-medium">{`${r.competency}:`}</span>{" "}
                      <span className="text-steel">{r.evidence}</span>
                    </span>
                  </li>
                ))}
            </ul>
            {c.humanScorecard?.ratings?.length || c.humanScorecard?.summary ? (
              // The recruiter's human scorecard for this candidate — its own ratings
              // + evidence, kept distinct from the AI list above.
              <div className="mt-2 border-t border-stone-200 pt-2">
                <p className="flex items-center gap-1 text-meta uppercase tracking-wide text-steel">
                  <ClipboardCheck size={11} className="text-coral" /> {t("humanScorecardHeading")}
                </p>
                {c.humanScorecard.summary ? <p className="mt-0.5 text-sm text-steel">{c.humanScorecard.summary}</p> : null}
                <ul className="mt-1 space-y-1">
                  {(c.humanScorecard.ratings ?? []).map((r, j) => (
                    <li key={j} className="flex items-baseline gap-1.5 text-sm text-ink">
                      <span className={`inline-flex h-5 w-6 shrink-0 items-center justify-center rounded font-semibold nums ${ratingColor(r.rating)}`}>
                        {r.rating}
                      </span>
                      <span>
                        <span className="font-medium">{`${r.competency}:`}</span>{" "}
                        {r.evidence ? <span className="text-steel">{r.evidence}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
