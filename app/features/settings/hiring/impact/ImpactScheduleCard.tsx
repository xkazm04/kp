"use client";

/*
 * Schedule, previewed as a MINIATURE WEEK GRID.
 *
 * The same `grid-cols-[2rem_repeat(5,1fr)]` shape ScheduleCalendar draws, with a
 * block in each channel the plan actually puts into play. The placement is a
 * representative week, not a forecast — the AI docket clears the morning it is
 * triggered, human rounds get booked mid-week — and it is labelled as one; the
 * legend under the grid carries the load-bearing claim (which surfaces are live).
 */
import { useLocale, useTranslations } from "next-intl";
import type { PlanImpact } from "../pipelineComposerModel";
import { ImpactCard, TONE } from "./impactShared";

/** Short weekday names Mon–Fri in the reader's locale, off a fixed reference week
 *  (2024-01-01 was a Monday) so the miniature never drifts with the clock. */
function weekdays(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return [0, 1, 2, 3, 4].map((i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
}

export function ImpactScheduleCard({ schedule, bookings }: { schedule: PlanImpact["schedule"]; bookings: number }) {
  const t = useTranslations("hiringPlan.impact");
  const locale = useLocale();
  const days = weekdays(locale);

  return (
    <ImpactCard
      tone="schedule"
      title={t("schedule")}
      sub={t("scheduleSub")}
      aside={
        bookings > 0 ? (
          <span className={`nums rounded-full px-2 py-0.5 text-sm font-semibold ${TONE.schedule.chip}`}>
            {t("bookingsN", { count: bookings })}
          </span>
        ) : null
      }
    >
      <div className="overflow-hidden rounded-md border border-stone-200" role="table" aria-label={t("weekAria")}>
        <div role="row" className="grid grid-cols-[2rem_repeat(5,1fr)] border-b border-stone-200 bg-paper text-center text-meta uppercase text-steel">
          <div role="columnheader">
            <span className="sr-only">{t("weekAria")}</span>
          </div>
          {days.map((d) => (
            <div key={d} role="columnheader" className="truncate py-1">
              {d}
            </div>
          ))}
        </div>
        {["09", "14"].map((hour, row) => (
          <div key={hour} role="row" className="grid grid-cols-[2rem_repeat(5,1fr)] border-t border-stone-100 first:border-t-0">
            <div role="rowheader" className="nums py-2 text-center text-sm text-steel">
              {hour}
            </div>
            {days.map((d, col) => {
              const ai = schedule.aiRound && row === 0 && (col === 1 || col === 3);
              const human = schedule.humanRound && row === 1 && col === 2;
              return (
                <div key={d} className="border-l border-stone-100 p-1">
                  {ai ? (
                    <span className="block truncate rounded bg-coral/15 px-1 py-0.5 text-sm font-semibold text-coral">{t("roundAi")}</span>
                  ) : human ? (
                    <span className="block truncate rounded bg-blue-50 px-1 py-0.5 text-sm font-semibold text-blue-700">{t("roundHuman")}</span>
                  ) : (
                    <span className="block h-6" />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {schedule.aiRound ? (
          <span className="rounded-full bg-coral/10 px-2 py-0.5 text-sm font-semibold text-coral">{t("schAiDocket")}</span>
        ) : null}
        {schedule.humanRound ? (
          <span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${TONE.schedule.chip}`}>{t("schCalendar")}</span>
        ) : null}
        {!schedule.aiRound && !schedule.humanRound ? (
          <span className={`rounded-full px-2 py-0.5 text-sm ${TONE.schedule.quiet}`}>{t("schNone")}</span>
        ) : null}
      </div>
    </ImpactCard>
  );
}
