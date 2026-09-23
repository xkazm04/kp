"use client";

// A recruiter's human scorecard (PREP1), styled to read as the human
// counterpart to the AI one — same rubric layout (rating meters + evidence),
// coral-tinted so the two are never confused. Used both alongside an AI
// screen and on its own. Split out of ScheduleInterviewTranscriptModal.tsx to
// keep the modal file under the 200-line cap.
//
// One section per record: an entry holds one human scorecard per (interviewer,
// round) (app/_lib/human-scorecard-set.ts, r09 schedule-interview-prep/A), so each
// section says whose it is and which round — or that it predates attribution.

import { ClipboardCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, interviewRecommendationToken } from "@/app/_components/Badge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { Scorecard } from "@/app/_lib/interview-scorecard";
import type { HumanScorecardRecord } from "@/app/_lib/human-scorecard-set";
import { ScorecardRatingRow } from "./ScheduleInterviewScorecardRow";

export function HumanScorecardSection({ sc }: { sc: Scorecard | HumanScorecardRecord }) {
  const t = useTranslations("scheduleTab.transcript");
  const enumLabel = useEnumLabel();
  // A record read through readHumanScorecards carries `savedAt` (null only on a card
  // lifted from the pre-list single key, whose author and round were never stored).
  const rec = "savedAt" in sc ? sc : null;
  const byline = !rec
    ? null
    : rec.savedAt === null
      ? t("humanScorecardLegacy")
      : rec.authorLabel
        ? t("humanScorecardBy", { author: rec.authorLabel })
        : t("humanScorecardUnnamed");
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
      {byline ? (
        <p className="mt-1 text-meta text-steel">
          {byline}
          {rec?.stage ? <> · {t("humanScorecardRound", { stage: rec.stage })}</> : null}
        </p>
      ) : null}
      {sc.summary ? <p className="mt-1.5 text-base text-ink">{sc.summary}</p> : null}
      {sc.ratings && sc.ratings.length ? (
        <ul className="mt-2.5 space-y-2.5">
          {sc.ratings.map((r, i) => (
            <ScorecardRatingRow key={i} r={r} t={t} />
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-meta text-steel">{t("humanScorecardNote")}</p>
    </section>
  );
}
