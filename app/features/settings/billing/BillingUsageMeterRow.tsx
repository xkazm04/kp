"use client";

import { AlertTriangle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import type { MeterOverview } from "@/app/_lib/billing";
import { meterCta } from "./billingMeterCta";
import { meterForecast, type ForecastWindow } from "./meterForecast";

// One usage meter: name, used-vs-limit progress bar, pack credits, and the
// over-quota flag. A null limit is the BYOM "unlimited" state — no bar, just
// the running count. Split out of BillingTab.tsx.
//
// Depleted interview_minutes still jumps to the minutes pack. Every other
// limited meter that hits 0 (and remaining in the last 20% before that)
// points at the plan catalog — the outcome-priced upgrade moment used to
// be a dead badge.
//
// With the allowance window (billingOverview.allowanceWindow) the row also states its
// PACE: meterForecast folds used / capacity / elapsed days into one verdict line, so
// 60% used on day 5 reads as the emergency it is and 80% on day 28 does not. A pace
// that runs out before the reset routes to the same pack / upgrade anchors as a
// depleted meter; hires say "billed as overage", never "runs out" (plans.ts).
export function MeterRow({
  meter,
  name,
  meterId,
  resetWindow,
}: {
  meter: MeterOverview;
  name: string;
  meterId?: string;
  resetWindow?: ForecastWindow | null;
}) {
  const t = useTranslations("billing.usage");
  const format = useFormatter();
  const limit = meter.limit;
  const cta = meterCta(meterId, meter.remaining, limit);
  const depleted = cta === "pack" || cta === "upgrade";
  const approaching = cta === "warn";
  const forecast = resetWindow ? meterForecast(meter, resetWindow) : null;
  const runsOut = forecast?.kind === "runsOutBeforeReset" ? forecast : null;
  // ONE recovery link per row: the depleted CTA, or the same anchor when the pace runs
  // out before the reset. The allowance window is UTC, so its dates are shown in UTC.
  const linkTo = cta === "pack" || cta === "upgrade" ? cta : runsOut ? (meterId === "interview_minutes" ? "pack" : "upgrade") : null;
  const link = linkTo ? (
    <a
      href={linkTo === "pack" ? "#billing-minutes-pack" : "#billing-plans"}
      className="font-medium text-coral underline underline-offset-2"
    >
      {linkTo === "pack" ? t("buyMinutesCta") : t("upgradeCta")}
    </a>
  ) : null;
  const paceLine =
    forecast === null
      ? null
      : forecast.kind === "tooEarly"
        ? t("forecast.tooEarly")
        : forecast.kind === "onPace"
          ? t("forecast.onPace")
          : forecast.kind === "overageProjected"
            ? t("forecast.overage")
            : forecast.kind === "runsOutBeforeReset"
              ? t("forecast.runsOut", {
                  date: format.dateTime(new Date(forecast.runsOutAt), { day: "numeric", month: "short", timeZone: "UTC" }),
                  days: forecast.daysBeforeReset,
                })
              : null;
  const pct =
    limit === null || limit === 0
      ? meter.used > 0
        ? 100
        : 0
      : Math.min(100, Math.round((meter.used / limit) * 100));
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-medium text-ink">{name}</span>
        {limit === null ? (
          <span className="text-sm text-steel">{t("usedUnlimited", { used: meter.used })}</span>
        ) : (
          <span className={`text-sm ${depleted ? "font-semibold text-coral" : approaching ? "font-medium text-amber-800" : "text-steel"}`}>
            {t("used", { used: meter.used, limit })}
          </span>
        )}
      </div>
      {limit === null || limit <= 0 ? null : (
        // A 0-allowance meter (free/BYOM tier) must NOT render a progressbar — aria-valuemax
        // must exceed valuemin, so max=0 is invalid. The "0 / 0" text above still conveys it.
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(meter.used, limit)}
          aria-label={name}
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-100"
        >
          <div className={`h-full rounded-full ${depleted ? "bg-coral" : approaching ? "bg-amber-500" : "bg-moss"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        {limit === null ? <Badge tone="info" label={t("unlimited")} /> : null}
        {depleted ? <Badge tone="critical" icon={AlertTriangle} label={t("depleted")} /> : null}
        {approaching ? <Badge tone="caution" icon={AlertTriangle} label={t("approaching")} /> : null}
        {limit !== null && !depleted ? (
          <span className={approaching ? "text-amber-800" : "text-steel"}>{t("remaining", { remaining: meter.remaining ?? 0 })}</span>
        ) : null}
        {meter.credits > 0 ? <span className="font-medium text-moss">{t("credits", { credits: meter.credits })}</span> : null}
        {depleted ? link : null}
      </div>
      {paceLine ? (
        <p className={`mt-1 text-sm ${runsOut || forecast?.kind === "overageProjected" ? "text-amber-800" : "text-steel"}`}>
          {paceLine}
          {runsOut && link ? <> {link}</> : null}
        </p>
      ) : null}
    </div>
  );
}
