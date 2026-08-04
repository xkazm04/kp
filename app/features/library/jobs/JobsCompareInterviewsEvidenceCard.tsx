"use client";

import { ClipboardCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { rubricLabel } from "@/app/_lib/interview-rubric";
import { useRubricStrings } from "@/app/_lib/use-rubric-strings";
import { isPlaceholderEvidence } from "@/app/_lib/interview-scorecard";
import { ratingColor, type Candidate } from "./jobsCompareInterviewsTypes";

// One candidate's evidence card (AI ratings + evidence quotes, plus a human
// scorecard section when present) — extracted verbatim from
// JobsCompareInterviews.tsx so that file stays under the 200-line split threshold.
export function JobsCompareInterviewsEvidenceCard({
  c,
  t,
}: {
  c: Candidate;
  t: ReturnType<typeof useTranslations<"jobs.compare">>;
}) {
  const rubricStrings = useRubricStrings();
  return (
    <div className="rounded-md border border-stone-200 bg-paper/40 p-3">
      <p className="font-medium text-ink">{c.candidateLabel}</p>
      {c.summary ? <p className="mt-0.5 text-sm text-steel">{c.summary}</p> : null}
      <ul className="mt-2 space-y-1">
        {/* Every evidenced rating, visibly — the quotes ARE the scorecard's
            accountability, so they must not hide behind hover tooltips. */}
        {c.ratings
          .filter((r) => !isPlaceholderEvidence(r.evidence))
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
                <span className="font-medium">{`${rubricLabel(r.competency, rubricStrings)}:`}</span>{" "}
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
                  <span className="font-medium">{`${rubricLabel(r.competency, rubricStrings)}:`}</span>{" "}
                  {r.evidence ? <span className="text-steel">{r.evidence}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
