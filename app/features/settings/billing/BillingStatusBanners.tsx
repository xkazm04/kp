"use client";

import { CheckCircle2, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { CheckoutBanner } from "./billingCheckoutBanner";

// Billing tab — the load-failed retry banner, the post-checkout confirmation
// banner, the tier-2 reserved-height placeholder, and the local-dev
// not-configured note. Split out of BillingTab.tsx.
export function BillingStatusBanners({
  checkout,
  planName,
  loadFailed,
  onRetry,
  hasData,
  configured,
}: {
  checkout: CheckoutBanner;
  planName: string;
  loadFailed: boolean;
  onRetry: () => void;
  hasData: boolean;
  configured: boolean;
}) {
  const t = useTranslations("billing");

  return (
    <>
      {checkout ? (
        <div
          role="status"
          aria-live="polite"
          className={`${PANEL} flex items-center gap-2.5 p-4 ${
            checkout === "confirmed" ? "border-moss/40 bg-moss/5" : "border-stone-200 bg-paper"
          }`}
        >
          <CheckCircle2
            size={18}
            className={`shrink-0 ${checkout === "confirmed" ? "text-moss" : "text-steel"}`}
            aria-hidden
          />
          <p className={`text-base font-medium ${checkout === "confirmed" ? "text-moss" : "text-steel"}`}>
            {checkout === "confirmed"
              ? t("checkoutDone", { plan: planName })
              : checkout === "unconfirmed"
                ? t("checkoutPending")
                : t("checkoutConfirming")}
          </p>
        </div>
      ) : null}

      {loadFailed ? (
        <div className={`${PANEL_SUNKEN} flex flex-wrap items-center gap-3 p-4`}>
          <p className="text-base text-coral">{t("loadFailed")}</p>
          <button type="button" onClick={onRetry} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {/* Tier 2: the overview fetch is in flight and there is nothing to show yet.
          Hold the current-plan + usage panels' height so the page doesn't jump when
          they land, and stay invisible for 150ms so a warm response paints nothing at
          all. (Was two pulsing skeleton slabs.) */}
      {!hasData && !loadFailed ? <div className="reveal-quiet min-h-[21rem]" aria-hidden /> : null}

      {/* Local-dev mode: the catalog still renders, purchases stay disabled. */}
      {hasData && !configured ? (
        <div className={`${PANEL_SUNKEN} flex items-start gap-2.5 p-3`}>
          <Info size={16} className="mt-0.5 shrink-0 text-steel" aria-hidden />
          <p className="text-sm text-steel">{t("notConfigured")}</p>
        </div>
      ) : null}
    </>
  );
}
