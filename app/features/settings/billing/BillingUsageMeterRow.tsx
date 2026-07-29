"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import type { MeterOverview } from "@/app/_lib/billing";

// One usage meter: name, used-vs-limit progress bar, pack credits, and the
// over-quota flag. A null limit is the BYOM "unlimited" state — no bar, just
// the running count. Split out of BillingTab.tsx.
export function MeterRow({ meter, name }: { meter: MeterOverview; name: string }) {
  const t = useTranslations("billing.usage");
  const limit = meter.limit;
  const depleted = limit !== null && meter.remaining === 0;
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
          <span className={`text-sm ${depleted ? "font-semibold text-coral" : "text-steel"}`}>
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
          <div className={`h-full rounded-full ${depleted ? "bg-coral" : "bg-moss"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        {limit === null ? <Badge tone="info" label={t("unlimited")} /> : null}
        {depleted ? <Badge tone="critical" icon={AlertTriangle} label={t("depleted")} /> : null}
        {limit !== null && !depleted ? (
          <span className="text-steel">{t("remaining", { remaining: meter.remaining ?? 0 })}</span>
        ) : null}
        {meter.credits > 0 ? <span className="font-medium text-moss">{t("credits", { credits: meter.credits })}</span> : null}
      </div>
    </div>
  );
}
