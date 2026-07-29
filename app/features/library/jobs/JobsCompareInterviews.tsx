"use client";

import { Scale } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { EmptyState } from "./JobsShared";
import { buildCohorts, type RubricComp } from "./jobsCompareCohorts";
import type { Candidate } from "./jobsCompareInterviewsTypes";
import { CohortTable } from "./JobsCompareInterviewsCohortTable";
import { JobsCompareInterviewsEvidenceCard } from "./JobsCompareInterviewsEvidenceCard";

export function CompareInterviews({ jobId }: { jobId: string }) {
  const t = useTranslations("jobs.compare");
  const locale = useLocale(); // PREP3 — localize the per-rating competency display
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
  // against that cohort's rubric (buildCohorts — known cohorts first, then any
  // others; a cohort with no matching rubric surfaces as an unrecognized one).
  const cohorts = buildCohorts(data.candidates, data.rubrics);

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
          <JobsCompareInterviewsEvidenceCard key={i} c={c} locale={locale} t={t} />
        ))}
      </div>
    </div>
  );
}
