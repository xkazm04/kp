"use client";

import { useTranslations } from "next-intl";
import { AnalyticsStatCluster } from "./AnalyticsStatCluster";
import { WINDOW_CHOICES, type Analytics } from "./AnalyticsTypes";

// The tab's header: eyebrow/title/intro, the cohort-window switcher, and the
// key-stat cluster. Split out of AnalyticsTab.tsx to keep that file under the
// 200-line cap.
export function AnalyticsHeader({
  data,
  error,
  days,
  setDays,
}: {
  data: Analytics | null;
  error: string | null;
  days: number | null;
  setDays: (w: number | null) => void;
}) {
  const t = useTranslations("analytics");
  return (
    <header className="flex flex-col gap-5 border-b border-stone-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        <p className="mt-2 max-w-3xl text-body text-steel">{t("intro")}</p>
        {/* ANA2: cohort window — every figure below scopes to entries created
            in the period (all-time stays the default). */}
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("windowLabel")}>
          {WINDOW_CHOICES.map((w) => (
            <button
              key={w ?? "all"}
              type="button"
              onClick={() => setDays(w)}
              aria-pressed={days === w}
              className={`focus-ring rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                days === w ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
              }`}
            >
              {w == null ? t("windowAll") : t("windowDays", { days: w })}
            </button>
          ))}
        </div>
        {/* W0.4 — the metric pack. The four numbers a buyer asks for (time-to-hire,
            cost-per-hire, recruiter hours saved, roles per recruiter) as one page, each
            carrying its sample and whether it is publishable. A plain link, not a fetch:
            the route streams the Markdown as a download. */}
        <a
          href={`/api/analytics/metric-pack?format=md${days ? `&days=${days}` : ""}`}
          className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1 text-sm font-semibold text-steel transition-colors hover:border-coral/40 hover:text-coral"
        >
          {t("metricPackDownload")}
        </a>
      </div>

      {/* Tier 2: nested inside the (always-rendering) header — quiet reserved
          box while the fetch is in flight, then the real figures fade in place. */}
      {!data && !error ? (
        <div className="reveal-quiet min-h-[6rem] shrink-0 lg:w-[22rem]" aria-hidden />
      ) : data ? (
        <AnalyticsStatCluster data={data} />
      ) : null}
    </header>
  );
}
