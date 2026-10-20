"use client";

// Whose human scorecard this is, and which round — shared by the candidate drawer's
// card and the compare grid's evidence card, so both say it in the same words as the
// transcript modal (the scheduleTab.transcript keys). The claim itself is decided by
// the pure humanScorecardByline (app/_lib/human-scorecard-set.ts).

import { useTranslations } from "next-intl";
import { humanScorecardByline, type HumanScorecardView } from "@/app/_lib/human-scorecard-set";

export function HumanScorecardByline({ view, className }: { view: HumanScorecardView; className?: string }) {
  const t = useTranslations("scheduleTab.transcript");
  const b = humanScorecardByline(view);
  const who =
    b.kind === "legacy" ? t("humanScorecardLegacy") : b.kind === "by" ? t("humanScorecardBy", { author: b.author ?? "" }) : t("humanScorecardUnnamed");
  return (
    <p className={className}>
      {who}
      {b.stage ? <> · {t("humanScorecardRound", { stage: b.stage })}</> : null}
    </p>
  );
}
