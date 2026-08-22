"use client";

/*
 * The impact strip — the hiring composer's core promise: every change immediately
 * narrates what Overview, Decisions and Schedule will look like under the composed
 * plan, so the recruiter composes consequences rather than abstract config.
 *
 * Winner of the /prototype round, 2026-08-19: "Mini-tabs" (each card is a
 * miniature of the surface it predicts, drawn in that surface's own grammar)
 * fused with the "Journey" direction's Decisions ladder — the one panel that also
 * draws the gates left on `auto`, which no reading built on `PlanImpact.decisions`
 * alone can show. It replaced three identical `ImpactPanel` rectangles of chips,
 * where nothing about a card said WHICH surface it predicted.
 *
 * Card identity (silhouette, accent, shell) lives once in ./impactShared.
 */
import { useTranslations } from "next-intl";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages";
import { deriveImpact, roundCount, type PipelinePlan } from "../pipelineComposerModel";
import { ImpactDecisionsCard } from "./ImpactDecisionsCard";
import { ImpactOverviewCard } from "./ImpactOverviewCard";
import { ImpactScheduleCard } from "./ImpactScheduleCard";
import { useImpactCopy } from "./impactShared";

export function PlanImpactStrip({ plan, axis = DEFAULT_STAGE_AXIS }: { plan: PipelinePlan; axis?: readonly StageDef[] }) {
  const t = useTranslations("hiringPlan.impact");
  const { stationLabel } = useImpactCopy(axis);
  const impact = deriveImpact(plan, axis);

  return (
    <section aria-label={t("heading")}>
      <p className="text-meta uppercase text-steel">{t("heading")}</p>
      <div className="mt-2 grid gap-3 lg:grid-cols-3">
        <ImpactOverviewCard stations={impact.overview} stationLabel={stationLabel} />
        <ImpactDecisionsCard plan={plan} touchpoints={impact.humanTouchpoints} axis={axis} />
        <ImpactScheduleCard schedule={impact.schedule} bookings={roundCount(plan)} />
      </div>
    </section>
  );
}
