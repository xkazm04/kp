"use client";

// One rubric rating row — the competency label, the N/RATING_MAX (or "not
// assessed") value, the guarded meter, and the evidence quote — shared by the
// AI scorecard and the human scorecard section (they render the row
// identically). Split out of ScheduleInterviewTranscriptModal.tsx to keep the
// modal file under the 200-line cap.

import type { ReactNode } from "react";
import type { useTranslations } from "next-intl";
import { rubricLabel } from "@/app/_lib/interview-rubric";
import { Meter } from "@/app/_components/Meter";
import { RATING_MAX, ratingToPercent, ratingTone } from "@/app/_lib/format";
import type { ScorecardRating } from "@/app/_lib/interview-scorecard";
import { cleanRating } from "./scheduleInterviewTranscriptHelpers";

// The evidence rendering is the only divergence, so it's an optional slot: the
// human card omits it (plain `<p>` default); the AI block passes a clickable
// jump-to-transcript renderer.
export function ScorecardRatingRow({
  r,
  t,
  locale,
  renderEvidence,
}: {
  r: ScorecardRating;
  t: ReturnType<typeof useTranslations<"scheduleTab.transcript">>;
  locale: string;
  renderEvidence?: (evidence: string) => ReactNode;
}) {
  const rating = cleanRating(r.rating);
  const label = rubricLabel(r.competency, locale);
  return (
    <li className="text-sm text-ink">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <span className="shrink-0 nums text-steel">{rating != null ? `${rating}/${RATING_MAX}` : t("notAssessed")}</span>
      </div>
      {rating != null ? (
        <Meter value={ratingToPercent(rating)} tone={ratingTone(rating)} className="mt-1" aria-label={t("ratingAria", { competency: label, rating, max: RATING_MAX })} />
      ) : null}
      {r.evidence
        ? renderEvidence
          ? renderEvidence(r.evidence)
          : <p className="mt-1 text-meta text-steel">{r.evidence}</p>
        : null}
    </li>
  );
}
