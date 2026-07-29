"use client";

import { useLocale, useTranslations } from "next-intl";
import { momentumWeekLabel, type MomentumWeek } from "@/app/_lib/analytics-momentum";

// ANA2 — the weekly trend: grouped mini-bars per rolling week (newest right),
// one bar per series. Heights normalize against the single largest weekly count
// so weeks compare honestly across the whole span.
//
// Loading choreography (docs/LOADING_CHOREOGRAPHY.md, tier 3): split out of
// AnalyticsTab.tsx so it can be its own next/dynamic chunk — the SVG-free bar
// chart is still real render work the tab's first paint shouldn't wait on.
const MOMENTUM_SERIES = [
  { key: "added", legend: "legendAdded", bar: "bg-steel/50" },
  { key: "advanced", legend: "legendAdvanced", bar: "bg-moss/70" },
  { key: "rejected", legend: "legendRejected", bar: "bg-coral/70" },
  { key: "hired", legend: "legendHired", bar: "bg-ink" },
] as const;

export function MomentumPanel({ weeks }: { weeks: MomentumWeek[] }) {
  const t = useTranslations("analytics");
  const locale = useLocale();
  const max = Math.max(1, ...weeks.flatMap((w) => MOMENTUM_SERIES.map((s) => w[s.key])));
  const quiet = weeks.every((w) => MOMENTUM_SERIES.every((s) => w[s.key] === 0));
  // weekStart is a UTC calendar date; render it pinned to UTC so the label shows the
  // correct day in every client timezone (see momentumWeekLabel).
  const weekLabel = (iso: string) => momentumWeekLabel(iso, locale);
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-h2 text-ink">{t("momentum")}</h3>
        <ul className="flex flex-wrap items-center gap-3 text-sm text-steel">
          {MOMENTUM_SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${s.bar}`} />
              {t(s.legend)}
            </li>
          ))}
        </ul>
      </div>
      {quiet ? (
        <p className="mt-4 rounded-md bg-paper p-3 text-base text-steel">{t("momentumEmpty")}</p>
      ) : (
        <ol className="mt-4 flex items-end gap-2">
          {weeks.map((w) => (
            <li key={w.weekStart} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              {/* role="img" + aria-label is the reliable text equivalent: a bare
                  <li aria-label> isn't announced across SRs. The role makes the bar
                  group's decorative children presentational automatically. */}
              <div
                role="img"
                aria-label={t("momentumWeekAria", {
                  date: weekLabel(w.weekStart),
                  added: w.added,
                  advanced: w.advanced,
                  rejected: w.rejected,
                  hired: w.hired,
                })}
                className="flex h-20 w-full items-end justify-center gap-0.5 rounded-md bg-paper px-1 pt-1"
              >
                {MOMENTUM_SERIES.map((s) => (
                  <div
                    key={s.key}
                    title={`${t(s.legend)}: ${w[s.key]}`}
                    className={`w-1/5 max-w-3 rounded-t-sm ${s.bar}`}
                    style={{ height: `${Math.round((w[s.key] / max) * 100)}%` }}
                  />
                ))}
              </div>
              <span aria-hidden className="truncate text-sm text-steel">{weekLabel(w.weekStart)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
