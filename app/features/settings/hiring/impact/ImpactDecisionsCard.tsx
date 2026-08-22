"use client";

/*
 * Decisions, previewed as a CHECKPOINT LADDER.
 *
 * The one panel in the strip that shows more than the plan's output: it walks
 * `gateLedger()` — EVERY point where a verdict could be ratified — so the gates
 * left on `auto` are drawn as hollow, dashed checkpoints the candidate passes
 * through unattended. `PlanImpact.decisions` lists only the human queues, so no
 * reading built on it alone can ever show what the recruiter switched off; that
 * blind spot is why the ladder replaced the queue-name chip row.
 *
 * Rows are named from the composer's own station vocabulary (`stationScreening`
 * / `stationRound` / `stationOffer`), so the ladder is a line-for-line mirror of
 * the policy table directly above it on the page.
 */
import { Bot, Check, UserRound, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { STAT_LABEL, STAT_VALUE } from "@/app/_components/ui/recipes";
import type { PipelinePlan } from "../pipelineComposerModel";
import { gateLedger, ImpactCard, useImpactCopy } from "./impactShared";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages";

export function ImpactDecisionsCard({
  plan,
  touchpoints,
  axis = DEFAULT_STAGE_AXIS,
}: {
  plan: PipelinePlan;
  touchpoints: number;
  axis?: readonly StageDef[];
}) {
  const t = useTranslations("hiringPlan.impact");
  const th = useTranslations("hiringPlan");
  const { stationLabel } = useImpactCopy(axis);
  const ledger = gateLedger(plan, axis);

  // A gate row is named after the COLUMN it sits at — the recruiter's own word
  // for it, which is the only name that survives two screening columns. Round
  // rows keep their ordinal, since several can share one column.
  const gateName = (row: (typeof ledger)[number]) =>
    row.kind === "round" ? th("stationRound", { n: row.n ?? 1 }) : stationLabel(row.stageId);

  return (
    <ImpactCard
      tone="decisions"
      title={t("decisions")}
      sub={t("decisionsSub")}
      aside={
        <>
          <span className={`${STAT_VALUE} block text-amber-700`}>{touchpoints}</span>
          <span className={STAT_LABEL}>{t("touchpointsLabel")}</span>
        </>
      }
    >
      <ol>
        {ledger.map((row, i) => {
          const human = row.mode === "human";
          const first = i === 0;
          const last = i === ledger.length - 1;
          return (
            <li key={row.key} className="flex items-stretch gap-3">
              <span aria-hidden className="relative flex w-6 shrink-0 justify-center">
                <span className={`absolute w-px bg-stone-200 ${first ? "bottom-0 top-1/2" : last ? "top-0 h-1/2" : "inset-y-0"}`} />
                <span
                  className={`relative mt-2.5 grid h-6 w-6 place-items-center rounded-full border-2 ${
                    human ? "border-dial-amber bg-amber-50 text-amber-700" : "border-dashed border-stone-300 bg-white text-steel"
                  }`}
                >
                  {human ? <Check size={13} /> : <Zap size={12} />}
                </span>
              </span>
              <span className="min-w-0 flex-1 border-b border-stone-200 py-2.5 last:border-b-0">
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-base ${human ? "font-medium text-ink" : "text-steel"}`}>{gateName(row)}</span>
                  {row.roundKind ? (
                    <span className="shrink-0 text-steel" aria-hidden>
                      {row.roundKind === "ai" ? <Bot size={13} /> : <UserRound size={13} />}
                    </span>
                  ) : null}
                </span>
                <span className={`block text-sm ${human ? "text-amber-800" : "text-steel"}`}>{human ? th("gateHuman") : th("gateAuto")}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {touchpoints === 0 ? (
        <div className="mt-2 rounded-md border border-dashed border-amber-300 bg-amber-50 p-2.5">
          <p className="text-meta uppercase text-amber-700">{t("unattended")}</p>
          <p className="mt-0.5 text-base text-amber-800">{t("decNone")}</p>
        </div>
      ) : null}
    </ImpactCard>
  );
}
