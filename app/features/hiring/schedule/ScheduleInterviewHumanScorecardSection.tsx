"use client";

// A recruiter's human scorecard (PREP1), styled to read as the human
// counterpart to the AI one — same rubric layout (rating meters + evidence),
// coral-tinted so the two are never confused. Used both alongside an AI
// screen and on its own. Split out of ScheduleInterviewTranscriptModal.tsx to
// keep the modal file under the 200-line cap.

import { ClipboardCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge, interviewRecommendationToken } from "@/app/_components/Badge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { Scorecard } from "@/app/_lib/interview-scorecard";
import { ScorecardRatingRow } from "./ScheduleInterviewScorecardRow";

export function HumanScorecardSection({ sc }: { sc: Scorecard }) {
  const t = useTranslations("scheduleTab.transcript");
  const enumLabel = useEnumLabel();
  const locale = useLocale(); // PREP3 — display the stored canonical competency localized
  return (
    <section className="rounded-md border border-coral/30 bg-coral/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <ClipboardCheck size={13} className="text-coral" /> {t("humanScorecard")}
        </p>
        {sc.recommendation ? (
          <Badge
            {...interviewRecommendationToken(sc.recommendation)}
            label={enumLabel("recommendation", sc.recommendation)}
            ariaLabel={t("recommendationAria", { label: enumLabel("recommendation", sc.recommendation) })}
          />
        ) : null}
      </div>
      {sc.summary ? <p className="mt-1.5 text-base text-ink">{sc.summary}</p> : null}
      {sc.ratings && sc.ratings.length ? (
        <ul className="mt-2.5 space-y-2.5">
          {sc.ratings.map((r, i) => (
            <ScorecardRatingRow key={i} r={r} t={t} locale={locale} />
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-meta text-steel">{t("humanScorecardNote")}</p>
    </section>
  );
}
