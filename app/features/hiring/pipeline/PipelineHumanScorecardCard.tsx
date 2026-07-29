"use client";

// PREP1 — the recruiter's own human-led scorecard for this candidate, surfaced
// so a human-led round isn't invisible the way the AI voice-screen scorecard
// used to be. Split out of PipelineCandidateDrawer.tsx.

import { ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { RATING_MAX } from "@/app/_lib/format";
import type { Scorecard } from "@/app/_lib/interview-scorecard";

const REC_STYLE: Record<string, string> = {
  advance: "bg-moss/15 text-moss",
  hold: "bg-dial-amber/20 text-ink",
  reject: "bg-coral/10 text-coral",
};

export function PipelineHumanScorecardCard({ humanSc }: { humanSc: Scorecard }) {
  const t = useTranslations("pipeline.drawer");
  const enumLabel = useEnumLabel();
  return (
    <div className="rounded-md border border-stone-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <ClipboardList size={13} /> {t("humanScorecard")}
        </p>
        {humanSc.recommendation ? (
          <span className={`rounded-full px-2 py-0.5 text-meta font-semibold uppercase ${REC_STYLE[humanSc.recommendation] ?? "bg-stone-100 text-steel"}`}>
            {enumLabel("recommendation", humanSc.recommendation)}
          </span>
        ) : null}
      </div>
      {humanSc.summary ? <p className="mt-1 text-sm text-ink">{humanSc.summary}</p> : null}
      {humanSc.ratings?.length ? (
        <ul className="mt-1.5 space-y-0.5">
          {humanSc.ratings.slice(0, 8).map((r, i) => (
            <li key={i} className="text-sm text-ink">
              <span className="font-semibold nums text-coral">{r.rating}/{RATING_MAX}</span> {r.competency}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1.5 text-meta text-steel">{t("humanScorecardNote")}</p>
    </div>
  );
}
