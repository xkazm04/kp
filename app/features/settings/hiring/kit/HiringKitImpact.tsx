"use client";

import { useLocale, useTranslations } from "next-intl";
import { ABSENT, KeyValueGrid, ListRow, Mark, Section, StatStrip, Tag, formatCount } from "@/app/_components/kit";
import type { MarkKind } from "@/app/_components/kit";
import { useStageDisplayLabel } from "@/app/features/shared/usePipelineAxisCopy";
import { deriveImpact, roundCount } from "../pipelineComposerModel";
import { boardTotal, deciders, type Composer, type Decider } from "./hiringKitModel";

const DECIDER_MARK: Record<Decider, MarkKind> = { human: "human", machine: "machine", nobody: "nobody" };

/**
 * What the drafted plan does to the Hiring tabs (the impact strip's promise, on the measure): a
 * stat strip of the three destinations (Overview: who is on the board; Decisions: the queues a
 * person must clear; Schedule: the rounds to book), then the board itself, one row per column with
 * who decides there (the mark), what runs there (tags) and who stands there now (figure + meter),
 * the Decisions ladder as one row, and which Schedule surfaces are live. Every reading is
 * deriveImpact over the plan as the server will read it, so the preview cannot disagree with a save.
 */
export function HiringKitImpact({ c }: { c: Composer }) {
  const t = useTranslations("hiringPlan.impact");
  const th = useTranslations("hiringPlan");
  const locale = useLocale();
  const display = useStageDisplayLabel();
  const plan = c.plan;
  const draft = c.axis;
  if (!plan || !draft) return null;
  const stages = draft.stages;
  const impact = deriveImpact(plan, stages);
  const who = deciders(plan, stages);
  const onBoard = boardTotal(stages, c.counts, c.countsLoaded);
  const max = Math.max(1, ...stages.map((s) => c.counts[s.id] ?? 0));
  const rounds = impact.overview.flatMap((o) => o.rounds);
  const human = stages.filter((s) => who[s.id] === "human").map((s) => display(s));
  const tipOf = (d: Decider) => (d === "human" ? th("gateHuman") : d === "machine" ? t("unattended") : t("noRounds"));

  return (
    <Section title={t("heading")} count={t("colsN", { count: stages.length })}>
      <StatStrip
        items={[
          { label: `${t("overview")} · ${t("overviewSub")}`, value: onBoard },
          { label: `${t("decisions")} · ${t("decisionsSub")}`, value: impact.humanTouchpoints },
          { label: `${t("schedule")} · ${t("scheduleSub")}`, value: roundCount(plan, stages) },
        ]}
      />
      {impact.overview.map((o) => {
        const stage = stages.find((s) => s.id === o.stageId)!;
        const n = c.countsLoaded ? (c.counts[o.stageId] ?? 0) : null;
        return (
          <ListRow
            key={o.stageId}
            mark={<Mark kind={DECIDER_MARK[who[o.stageId]]} tip={tipOf(who[o.stageId])} />}
            name={display(stage)}
            meta={
              o.rounds.length > 0 ? (
                <span className="k-chips">
                  {o.rounds.map((k, i) => (
                    <Tag key={i} label={k === "ai" ? t("roundAi") : t("roundHuman")} />
                  ))}
                </span>
              ) : (
                <span className="k-absent">{t("noRounds")}</span>
              )
            }
            fig={
              n == null ? (
                <span className="k-absent">{ABSENT}</span>
              ) : (
                <>
                  {formatCount(n, locale)}
                  <span className="k-meter" aria-hidden>
                    <i style={{ width: `${Math.round((100 * n) / max)}%` }} />
                  </span>
                </>
              )
            }
          />
        );
      })}
      <ListRow
        mark={<Mark kind={impact.humanTouchpoints > 0 ? "human" : "nobody"} tip={t("decisions")} />}
        name={t("decisions")}
        meta={human.length > 0 ? human.join(" · ") : <span className="k-absent">{t("decNone")}</span>}
        fig={
          <>
            {formatCount(impact.humanTouchpoints, locale)}
            {/* The column rows' meter width, kept empty, so this numeral lines up with theirs. */}
            <span className="k-meter" aria-hidden style={{ visibility: "hidden" }} />
          </>
        }
      />
      <div style={{ padding: "4px 0 0 calc(var(--m-mark) + var(--m-gap))" }}>
        <KeyValueGrid
          cols={2}
          items={[
            { label: t("schAiDocket"), value: impact.schedule.aiRound ? formatCount(rounds.filter((k) => k === "ai").length, locale) : null, absent: t("schNone") },
            { label: t("schCalendar"), value: impact.schedule.humanRound ? formatCount(rounds.filter((k) => k === "human").length, locale) : null, absent: t("schNone") },
          ]}
        />
      </div>
    </Section>
  );
}
