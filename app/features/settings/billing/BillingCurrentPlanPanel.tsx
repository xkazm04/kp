"use client";

import { AlertTriangle, ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { BTN_PRIMARY, BTN_SECONDARY, DIVIDER, META_LABEL, NOTICE, PANEL } from "@/app/_components/ui/recipes";
import { PlanPrice } from "./BillingPlanPrice";
import { dunningBanner, STATUS_TONE, type BillingPayload } from "./billingTypes";
import { planDatesView } from "./meterForecast";

// Billing tab — the current-plan card: name, price, lifecycle status, period
// end, manage-in-portal. Split out of BillingTab.tsx.
//
// This used to also render "this period's usage meters" as a second panel. The
// meters moved into the consolidated Usage & cost section below (spend/), where
// they sit beside the AI spend they constrain — the two were answering one
// question from two cards, and neither said what the other knew.
export function BillingCurrentPlanPanel({
  data,
  statusLabel,
  onManage,
  portalBusy,
  portalNote,
}: {
  data: BillingPayload;
  statusLabel: (status: string) => string;
  onManage: () => void;
  portalBusy: boolean;
  portalNote: { text: string; hint: boolean; url?: string } | null;
}) {
  const t = useTranslations("billing");
  const format = useFormatter();
  // Recovery, not chrome: past_due/unpaid used to share the Manage-subscription
  // weight of an active sub. Polar's portal is the only place to update the card,
  // so a failed payment gets an alert + Update-payment CTA on the same handler.
  const dunning = data.configured ? dunningBanner(data.status) : null;
  const dunningCopy =
    dunning === "unpaid"
      ? t("dunning.unpaid")
      : dunning === "pastDue"
        ? t("dunning.pastDue", {
            hasDate: data.periodEnd ? "yes" : "no",
            date: data.periodEnd
              ? format.dateTime(new Date(data.periodEnd), { dateStyle: "long" })
              : "",
          })
        : null;
  // Two different dates, and the card used to show one as if it were both: the PAID
  // period ends on the subscription's anniversary, the included allowances reset on
  // the 1st (UTC). They coincide only for a subscription anchored on the 1st, so the
  // card names both exactly when they differ (planDatesView, meterForecast.ts).
  const resetsAt = data.metered ? (data.allowanceWindow?.resetsAt ?? null) : null;
  const dates = planDatesView({ paidPeriodEnd: data.periodEnd, resetsAt });
  const longDate = (iso: string, utc = false) =>
    format.dateTime(new Date(iso), utc ? { dateStyle: "long", timeZone: "UTC" } : { dateStyle: "long" });

  return (
    <div className={`${PANEL} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={META_LABEL}>{t("currentPlan")}</p>
          <p className="mt-1 font-serif text-h2 text-ink">{data.plan.name}</p>
          {/* plans-checkout-billing-ui #5: shared renderer — Enterprise (contactSales)
                now shows "Custom", not the "Free" the old priceCzk===0 branch printed. */}
          <PlanPrice plan={data.plan} size="header" />
          {data.periodEnd && dates.diverge && resetsAt ? (
            <>
              <p className="mt-1 text-sm text-steel">{t("paidPeriodEnd", { date: longDate(data.periodEnd) })}</p>
              <p className="text-sm text-steel">{t("allowancesReset", { date: longDate(resetsAt, true) })}</p>
            </>
          ) : data.periodEnd ? (
            <p className="mt-1 text-sm text-steel">{t("periodEnd", { date: longDate(data.periodEnd) })}</p>
          ) : null}
        </div>
        <Badge
          tone={STATUS_TONE[data.status] ?? "neutral"}
          label={statusLabel(data.status)}
          dot={data.status === "active" || data.status === "trialing"}
          className="shrink-0"
        />
      </div>
      {dunning && dunningCopy ? (
        <div
          role="alert"
          className={`${NOTICE(dunning === "unpaid" ? "critical" : "amber")} mt-4 flex flex-wrap items-center gap-3 p-3`}
        >
          <AlertTriangle size={16} className="shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">{dunningCopy}</p>
          <button
            type="button"
            onClick={onManage}
            disabled={portalBusy}
            className={`${BTN_PRIMARY} h-9 shrink-0 px-3 text-sm`}
          >
            {portalBusy ? t("manageOpening") : t("dunning.updatePayment")}
          </button>
        </div>
      ) : null}
      <div className={`mt-4 flex flex-wrap items-center gap-3 ${DIVIDER} pt-4`}>
        <button
          type="button"
          onClick={onManage}
          disabled={!data.configured || portalBusy}
          className={`${BTN_SECONDARY} h-9 px-3 text-sm`}
        >
          <ExternalLink size={14} aria-hidden />{" "}
          {portalBusy ? t("manageOpening") : t("manage")}
        </button>
        {portalNote ? (
          <p
            role={portalNote.hint ? "status" : "alert"}
            className={`text-sm ${portalNote.hint ? "text-steel" : "text-coral"}`}
          >
            {portalNote.text}
            {/* plans-checkout-billing-ui #3: when a popup blocker killed the pre-opened
                  tab, offer a manual link so the portal is never an unreachable dead-end. */}
            {portalNote.url ? (
              <>
                {" "}
                <a
                  href={portalNote.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                >
                  {t("portalOpenLink")}
                </a>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
