"use client";

import { ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { META_LABEL, PANEL, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import { PlanPrice } from "./BillingPlanPrice";
import { MeterRow } from "./BillingUsageMeterRow";
import { STATUS_TONE, type BillingPayload } from "./billingTypes";

// Billing tab — the current-plan card (name, price, lifecycle status, period
// end, manage-in-portal) plus this period's usage meters panel. Split out of
// BillingTab.tsx.
export function BillingCurrentPlanPanel({
  data,
  statusLabel,
  meterName,
  onManage,
  portalBusy,
  portalNote,
}: {
  data: BillingPayload;
  statusLabel: (status: string) => string;
  meterName: (meter: string) => string;
  onManage: () => void;
  portalBusy: boolean;
  portalNote: { text: string; hint: boolean; url?: string } | null;
}) {
  const t = useTranslations("billing");
  const format = useFormatter();

  return (
    <>
      {/* Current plan: name, price, lifecycle status, period end, portal. */}
      <div className={`${PANEL} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={META_LABEL}>{t("currentPlan")}</p>
            <p className="mt-1 font-serif text-h2 text-ink">{data.plan.name}</p>
            {/* plans-checkout-billing-ui #5: shared renderer — Enterprise (contactSales)
                now shows "Custom", not the "Free" the old priceCzk===0 branch printed. */}
            <PlanPrice plan={data.plan} size="header" />
            {data.periodEnd ? (
              <p className="mt-1 text-sm text-steel">
                {t("periodEnd", { date: format.dateTime(new Date(data.periodEnd), { dateStyle: "long" }) })}
              </p>
            ) : null}
          </div>
          <Badge
            tone={STATUS_TONE[data.status] ?? "neutral"}
            label={statusLabel(data.status)}
            dot={data.status === "active" || data.status === "trialing"}
            className="shrink-0"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4">
          <button
            type="button"
            onClick={onManage}
            disabled={!data.configured || portalBusy}
            className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
          >
            <ExternalLink size={14} aria-hidden /> {portalBusy ? t("manageOpening") : t("manage")}
          </button>
          {portalNote ? (
            <p role={portalNote.hint ? "status" : "alert"} className={`text-sm ${portalNote.hint ? "text-steel" : "text-coral"}`}>
              {portalNote.text}
              {/* plans-checkout-billing-ui #3: when a popup blocker killed the pre-opened
                  tab, offer a manual link so the portal is never an unreachable dead-end. */}
              {portalNote.url ? (
                <>
                  {" "}
                  <a href={portalNote.url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                    {t("portalOpenLink")}
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      {/* This period's meters: included allowance + pack credits. */}
      <div className={`${PANEL} p-5`}>
        <h3 className="font-serif text-h3 text-ink">{t("usage.title")}</h3>
        <p className="mt-1 max-w-2xl text-sm text-steel">{t("usage.intro")}</p>
        {data.meters.length === 0 ? (
          <p className="mt-3 text-base text-steel">{t("usage.empty")}</p>
        ) : (
          <div className="mt-4 space-y-4">
            {data.meters.map((meter) => (
              <MeterRow key={meter.meter} meter={meter} name={meterName(meter.meter)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
