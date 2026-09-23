"use client";

import { useLocale, useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import type { Station } from "./spine";
import { formatWait, pct } from "./cohortFormat";

type CohortStationProps = {
  station: Station;
  total: number;
  /** The same station over all roles, when one role is selected. */
  cohort?: Station;
  cohortTotal?: number;
  /** 1-based rank among the stations with the most failures, when in the top three. */
  rank?: number;
  last: boolean;
};

/**
 * One stage of the hiring process: its name alone on the left, the river in the middle (its
 * width is the share of journeys still on the path here), and on the right the two things
 * this layer is for - how many journeys reach the stage, and how many are lost there.
 */
export function CohortStation({ station: s, total, cohort, cohortTotal, rank, last }: CohortStationProps) {
  const t = useTranslations("journey.cohort");
  const locale = useLocale();
  const share = total ? s.reached / total : 0;
  const hot = rank != null;
  const name = s.keys.map((k) => t(`stage.${k}` as "stage.source")).join(" / ");

  return (
    <li className="grid grid-cols-[minmax(8rem,12rem)_4rem_minmax(0,1fr)] gap-x-8" data-testid={`journey-cohort-station-${s.index}`}>
      <div className="flex flex-col items-end text-right">
        <span className={`font-serif text-h2 leading-tight ${hot ? "text-red-700" : "text-ink"}`}>{name}</span>
        {hot && (
          <span className="mt-2 rounded-full bg-red-50 px-2.5 py-0.5 text-meta text-red-700">{t("rank", { rank: rank ?? 0 })}</span>
        )}
      </div>

      <div className="relative flex justify-center" aria-hidden="true">
        <span
          className={`absolute top-2 bottom-0 rounded-t-sm bg-coral/15 ${last ? "rounded-b-full" : ""}`}
          style={{ width: `${Math.max(6, Math.round(52 * share))}px` }}
        />
        <span className={`relative z-10 mt-1.5 h-4 w-4 rounded-full border-2 bg-paper ${hot ? "border-red-600" : "border-coral"}`} />
      </div>

      <div className="grid grid-cols-2 gap-x-10 gap-y-2 pb-12">
        <section>
          <h3 className={META_LABEL}>{t("coverage")}</h3>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-serif text-display leading-none nums text-ink">{pct(s.reached, total)}%</span>
            <span className="text-body nums text-steel">{t("reached", { reached: s.reached, total })}</span>
          </div>
          <Bar value={share} tone="bg-coral" tick={cohort && cohortTotal ? cohort.reached / cohortTotal : undefined} />
          {cohort && cohortTotal ? <p className="mt-1 text-meta nums text-steel">{t("cohortShare", { pct: pct(cohort.reached, cohortTotal) })}</p> : null}
          {s.skipped > 0 && <p className="mt-1 text-meta nums text-steel">{t("skipped", { count: s.skipped })}</p>}
        </section>

        <section>
          <h3 className={META_LABEL}>{t("failures")}</h3>
          {s.exits + s.friction === 0 ? (
            <p className="mt-2 text-body text-steel">{t("noFailures")}</p>
          ) : (
            <div className="mt-2 space-y-2">
              <FailureLine label={t("leftHere", { count: s.exits })} value={pct(s.exits, s.reached)} tone="bg-red-500" />
              <FailureLine label={t("stumbled", { count: s.friction })} value={pct(s.friction, s.reached)} tone="bg-amber-400" />
            </div>
          )}
        </section>

        {Number.isFinite(s.medWait) && (
          <p className="col-span-2 text-meta nums text-steel">
            {t("wait", { value: formatWait(s.medWait, locale) })}
            {Number.isFinite(s.p75Wait) ? ` · ${t("waitP75", { value: formatWait(s.p75Wait, locale) })}` : ""}
          </p>
        )}
      </div>
    </li>
  );
}

function Bar({ value, tone, tick }: { value: number; tone: string; tick?: number }) {
  return (
    <div className="relative mt-2 h-2 rounded-full bg-stone-100">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${Math.round(100 * Math.min(1, value))}%` }} />
      {tick != null && <span className="absolute -top-1 h-4 w-0.5 rounded bg-ink/70" style={{ left: `${Math.round(100 * Math.min(1, tick))}%` }} />}
    </div>
  );
}

function FailureLine({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body text-ink">{label}</span>
        <span className="text-h3 nums text-ink">{value}%</span>
      </div>
      <Bar value={value / 100} tone={tone} />
    </div>
  );
}
