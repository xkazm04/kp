"use client";

// The open, editable form body of the human interviewer scorecard (PREP1):
// per-competency rating + evidence rows, the overall verdict picker, and the
// summary field. Split out of ScheduleHumanScorecardPanel.tsx to keep the
// panel file under the 200-line cap.

import { Info } from "lucide-react";
import type { useTranslations } from "next-intl";
import { TextArea } from "@/app/_components/TextArea";
import type { LocalizedRubricCompetency } from "@/app/_lib/interview-rubric";
import { INTERVIEW_RECOMMENDATIONS, type InterviewRecommendation } from "@/app/_lib/interview-recommendation";

const REC_STYLE: Record<InterviewRecommendation, string> = {
  advance: "bg-moss text-white",
  hold: "bg-dial-amber text-ink",
  reject: "bg-coral text-white",
};

export function ScheduleHumanScorecardForm({
  rubric,
  ratingAnchors,
  ratingMax,
  familyMissing,
  ratings,
  evidence,
  setRating,
  setEvidence,
  recommendation,
  setRecommendation,
  summary,
  setSummary,
  enumLabel,
  t,
}: {
  rubric: LocalizedRubricCompetency[];
  ratingAnchors: Record<number, string>;
  ratingMax: number;
  familyMissing: boolean;
  ratings: Record<string, number>;
  evidence: Record<string, string>;
  setRating: (competency: string, rating: number) => void;
  setEvidence: (competency: string, text: string) => void;
  recommendation: InterviewRecommendation | "";
  setRecommendation: (r: InterviewRecommendation | "") => void;
  summary: string;
  setSummary: (s: string) => void;
  enumLabel: (group: string, slug: string | null | undefined) => string;
  t: ReturnType<typeof useTranslations<"scheduleTab.scorecard">>;
}) {
  return (
    <>
      <p className="mt-1 text-sm text-steel">{t("rateEach", { max: ratingMax })}</p>

      {familyMissing ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-meta text-amber-800">
          <Info size={13} className="mt-0.5 shrink-0" aria-hidden /> {t("genericRubricNote")}
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        {rubric.map((c) => {
          const chosen = ratings[c.competency];
          const anchorText = chosen != null ? c.anchors?.[String(chosen)] ?? ratingAnchors[chosen] : null;
          return (
            <div key={c.competency} className="rounded-md border border-stone-200 bg-white p-2.5">
              <p className="text-sm font-semibold text-ink">{c.label}</p>
              <p className="mt-0.5 text-meta text-steel">{c.description}</p>
              <div className="mt-1.5 flex items-center gap-1">
                {Array.from({ length: ratingMax }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(c.competency, n)}
                    aria-pressed={chosen === n}
                    className={`focus-ring h-7 w-7 rounded-md text-sm font-semibold ${
                      chosen === n ? "bg-ink text-white" : "border border-stone-200 text-steel hover:border-coral/40"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                {anchorText ? <span className="ml-2 text-meta text-steel">{anchorText}</span> : null}
              </div>
              <TextArea
                value={evidence[c.competency] ?? ""}
                onChange={(e) => setEvidence(c.competency, e.target.value)}
                rows={2}
                placeholder={t("evidencePlaceholder")}
                sizeVariant="sm"
                className="mt-2 p-1.5"
              />
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{t("verdict")}</span>
        {INTERVIEW_RECOMMENDATIONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRecommendation(recommendation === r ? "" : r)}
            aria-pressed={recommendation === r}
            className={`focus-ring rounded-full px-3 py-1 text-sm font-semibold capitalize transition-colors ${
              recommendation === r ? REC_STYLE[r] : "border border-stone-200 text-steel hover:border-coral/40"
            }`}
          >
            {enumLabel("recommendation", r)}
          </button>
        ))}
      </div>
      <TextArea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={2}
        placeholder={t("summaryPlaceholder")}
        sizeVariant="sm"
        className="mt-2"
      />
    </>
  );
}
