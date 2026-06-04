"use client";

import { Scale } from "lucide-react";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { InterviewRecommendation } from "@/app/_lib/interview-recommendation";
import { EmptyState } from "./JobsShared";

type Rating = { competency: string; rating: number; evidence?: string };
type Candidate = {
  entryId: string | null;
  candidateLabel: string | null;
  recommendation: InterviewRecommendation | null;
  summary: string | null;
  scoringModel: string;
  confidence: { level: string; reason?: string } | null;
  ratings: Rating[];
};
type RubricComp = { competency: string; description: string; anchors?: Record<string, string> };

// Candidates are comparable WITHIN a cohort, not across — an experienced hire's
// track-record axes and a student's potential constructs are different rubrics.
const COHORT_LABEL: Record<string, string> = {
  experienced: "Experienced",
  early_career: "Early-career — potential & mental model",
};
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
  const ratingOf = (c: Candidate, comp: string) =>
    c.ratings.find((r) => r.competency.toLowerCase() === comp.toLowerCase());

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-base">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white p-2 text-left text-meta uppercase text-steel">Competency</th>
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
                      {c.recommendation}
                    </span>
                  ) : null}
                  {c.confidence ? (
                    <span
                      className={`text-meta ${CONF_STYLE[c.confidence.level] ?? "text-steel"}`}
                      title={c.confidence.reason || ""}
                    >
                      {c.confidence.level} confidence
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
  const { data, error } = useJsonFetch<{ rubrics: Record<string, RubricComp[]>; candidates: Candidate[] }>(
    `/api/interview/compare?job=${encodeURIComponent(jobId)}`,
    "Couldn't load interviews."
  );

  if (error) return <p className="text-base text-coral">{error}</p>;
  if (!data) return <p className="text-base text-steel">Loading interviews…</p>;
  if (data.candidates.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title="No completed voice interviews yet"
        body="Run a voice screen from the pipeline — finished interviews line up here, scored on a rubric matched to each candidate for side-by-side comparison."
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
        {cohorts.length > 1
          ? "Each candidate is scored on the rubric for their cohort — compare within a cohort; the rubrics aren't directly comparable across cohorts."
          : "Every interview scored on the same rubric — compare like for like."}
      </p>

      {cohorts.map((g) => (
        <div key={g.model} className="mt-4">
          {cohorts.length > 1 ? (
            <p className="text-meta uppercase tracking-wide text-steel">{COHORT_LABEL[g.model] ?? g.model}</p>
          ) : null}
          <CohortTable rubric={g.rubric} candidates={g.candidates} />
        </div>
      ))}

      <p className="mt-5 text-meta uppercase text-steel">Highlights</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {data.candidates.map((c, i) => (
          <div key={i} className="rounded-md border border-stone-200 bg-paper/40 p-3">
            <p className="font-medium text-ink">{c.candidateLabel}</p>
            {c.summary ? <p className="mt-0.5 text-sm text-steel">{c.summary}</p> : null}
            <ul className="mt-2 space-y-1">
              {c.ratings
                .filter((r) => r.evidence && r.evidence !== "Not assessed.")
                .slice(0, 3)
                .map((r, j) => (
                  <li key={j} className="text-sm text-ink">
                    <span className="font-medium">{r.competency}:</span> <span className="text-steel">{r.evidence}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
