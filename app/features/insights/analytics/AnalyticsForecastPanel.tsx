"use client";

import { useTranslations } from "next-intl";
import { forecastHires } from "@/app/_lib/analytics-forecast";
import type { MomentumWeek } from "@/app/_lib/analytics-momentum";
import type { OfferConversion } from "@/app/_lib/analytics-offer";
import type { Funnel } from "./AnalyticsTypes";

// 094b5870 — forward hire projection, computed client-side from the same payload
// the rest of the page renders (pure forecastHires — no extra fetch). Shows the
// expected hires already in flight, an inflow projection over a few horizons, and
// the average time-to-hire as the realization lag. Below the signal floor (no
// hires observed yet) it says so rather than projecting a misleading zero. Split
// out of AnalyticsTab.tsx to keep that file under the 200-line cap.
export function ForecastPanel({
  funnel,
  momentum,
  avgTimeToHireDays,
  offers,
}: {
  funnel: Funnel[];
  momentum: MomentumWeek[];
  avgTimeToHireDays: number | null;
  offers: OfferConversion;
}) {
  const t = useTranslations("analytics.forecast");
  const f = forecastHires({
    weeklyAdded: momentum.map((w) => w.added),
    funnel: funnel.map((r) => ({ stage: r.stage, reached: r.reached, current: r.current })),
    avgTimeToHireDays,
    // Direction 1 — the measured accept rate (null below the min-offers gate, so
    // the projection stays exactly as before until there are enough offers).
    offerAcceptRate: offers.acceptRate,
  });
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
      {!f.hasSignal ? (
        <p className="mt-3 rounded-md bg-paper p-3 text-base text-steel">{t("noSignal")}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-steel">
            {t("basis", { velocity: f.weeklyVelocity, conv: f.overallConversionPct ?? 0 })}
          </p>
          {/* Direction 1 — state the acceptance assumption the projection now
              rests on, only once the offer-accept rate cleared the honesty gate. */}
          {f.offerAcceptRate != null && offers.acceptRatePct != null ? (
            <p className="mt-0.5 text-sm text-steel">{t("acceptBasis", { pct: offers.acceptRatePct, n: offers.n })}</p>
          ) : null}
          <dl className="mt-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <dt className="text-base text-ink">{t("inFlight")}</dt>
              <dd className="font-serif text-h2 leading-none text-moss">{f.inFlightExpectedHires}</dd>
            </div>
            {f.projected.map((p) => (
              <div key={p.weeks} className="flex items-baseline justify-between border-t border-stone-100 pt-2">
                <dt className="text-base text-steel">{t("horizon", { weeks: p.weeks })}</dt>
                <dd className="text-base font-semibold text-ink">{t("plusHires", { hires: p.hires })}</dd>
              </div>
            ))}
          </dl>
          {f.etaDays != null ? <p className="mt-3 text-meta text-steel">{t("eta", { days: f.etaDays })}</p> : null}
        </>
      )}
    </div>
  );
}
