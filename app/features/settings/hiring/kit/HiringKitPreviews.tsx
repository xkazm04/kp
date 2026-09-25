"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FigureView, Mark, Section, Tag } from "@/app/_components/kit";
import { deriveImpact, occupancyMark, roundCount } from "../pipelineComposerModel";
import { gateLedger, useImpactCopy } from "../impact/impactShared";
import type { Composer } from "./hiringKitModel";
import "./hiringKitPreviews.css";

/** Short weekday names Mon-Fri in the reader's locale, off a fixed reference week (2024-01-01 was a
 *  Monday), as ImpactScheduleCard reads them. */
function weekdays(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return [0, 1, 2, 3, 4].map((i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
}

function Pane({ title, sub, aside, children }: { title: string; sub: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="hk-prev__pane" aria-label={title}>
      <header className="hk-prev__head">
        <div>
          <p className="hk-prev__title">{title}</p>
          <p className="hk-prev__sub">{sub}</p>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

/**
 * What the drafted plan does to the Hiring tabs - the current tab's three previews, kept as its one
 * unique feature and redrawn in the kit's family: a miniature of the Overview board (its columns,
 * what runs at each, who stands there), the Decisions ladder (every gate, the ones left on auto
 * included, marked by shape), and a representative Schedule week (labelled as one). Every reading
 * is deriveImpact / gateLedger over the plan as the server will read it.
 */
export function HiringKitPreviews({ c }: { c: Composer }) {
  const t = useTranslations("hiringPlan.impact");
  const th = useTranslations("hiringPlan");
  const locale = useLocale();
  const stages = c.axis?.stages ?? [];
  const { stationLabel } = useImpactCopy(stages);
  const plan = c.plan;
  if (!plan || !c.axis) return null;
  const impact = deriveImpact(plan, stages);
  const ledger = gateLedger(plan, stages);
  const rounds = roundCount(plan, stages);
  const days = weekdays(locale);

  return (
    <Section title={t("heading")} count={t("colsN", { count: stages.length })}>
      <div className="hk-prev" data-role="hiring-previews">
        <Pane title={t("overview")} sub={t("overviewSub")} aside={<span className="hk-prev__aside">{t("colsN", { count: stages.length })}</span>}>
          <div className="hk-board" style={{ gridTemplateColumns: `repeat(${impact.overview.length}, minmax(4rem, 1fr))` }}>
            {impact.overview.map((o) => {
              const mark = occupancyMark(c.countsLoaded, c.counts[o.stageId]);
              return (
                <div key={o.stageId} className="hk-board__col">
                  <p className={`hk-board__h${o.rounds.length > 0 ? " is-live" : ""}`} data-tip={stationLabel(o.stageId)}>
                    {stationLabel(o.stageId)}
                  </p>
                  <div className="hk-board__cell">
                    {o.rounds.length > 0 ? (
                      o.rounds.map((k, i) => <Tag key={i} label={k === "ai" ? t("roundAi") : t("roundHuman")} />)
                    ) : (
                      <span className="k-absent" aria-label={t("noRounds")}>·</span>
                    )}
                    {mark === "omit" ? null : (
                      <span className="hk-board__n">{t("occupancy", { count: mark === "empty" ? 0 : mark })}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Pane>

        <Pane title={t("decisions")} sub={t("decisionsSub")} aside={<FigureView figure={{ label: t("touchpointsLabel"), value: impact.humanTouchpoints }} />}>
          <ol className="hk-ladder">
            {ledger.map((row) => {
              const human = row.mode === "human";
              return (
                <li key={row.key} className={human ? undefined : "is-auto"}>
                  <Mark kind={human ? "human" : "machine"} tip={human ? th("gateHuman") : t("unattended")} />
                  <span className="min-w-0">
                    <b>{row.kind === "round" ? th("stationRound", { n: row.n ?? 1 }) : stationLabel(row.stageId)}</b>
                    <small>{human ? th("gateHuman") : th("gateAuto")}</small>
                  </span>
                </li>
              );
            })}
          </ol>
          {impact.humanTouchpoints === 0 ? <p className="hk-prev__note">{t("decNone")}</p> : null}
        </Pane>

        <Pane title={t("schedule")} sub={t("scheduleSub")} aside={<FigureView figure={{ label: th("kit.roundsToBook"), value: rounds }} />}>
          <div className="hk-week" role="table" aria-label={t("weekAria")}>
            <div className="hk-week__row" role="row">
              <div className="hk-week__h" role="columnheader">
                <span className="sr-only">{t("weekAria")}</span>
              </div>
              {days.map((d) => (
                <div key={d} className="hk-week__h" role="columnheader">{d}</div>
              ))}
            </div>
            {["09", "14"].map((hour, row) => (
              <div key={hour} className="hk-week__row" role="row">
                <div className="hk-week__t" role="rowheader">{hour}</div>
                {days.map((d, col) => {
                  const ai = impact.schedule.aiRound && row === 0 && (col === 1 || col === 3);
                  const human = impact.schedule.humanRound && row === 1 && col === 2;
                  return (
                    <div key={d} role="cell">
                      {ai ? <span className="hk-week__block is-ai">{t("roundAi")}</span> : human ? <span className="hk-week__block is-human">{t("roundHuman")}</span> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="hk-prev__note">{t("weekNote")}</p>
          <div className="hk-prev__legend">
            {impact.schedule.aiRound ? <Tag label={t("schAiDocket")} /> : null}
            {impact.schedule.humanRound ? <Tag label={t("schCalendar")} /> : null}
            {!impact.schedule.aiRound && !impact.schedule.humanRound ? <Tag label={t("schNone")} /> : null}
          </div>
          {rounds > 0 ? <span className="sr-only">{t("bookingsN", { count: rounds })}</span> : null}
        </Pane>
      </div>
    </Section>
  );
}
