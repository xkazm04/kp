"use client";

import { CheckCircle2, Info, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { supportContactHref } from "@/app/_lib/sales-contact";
import type { CheckoutBanner } from "./billingCheckoutBanner";

// Billing tab — the load-failed retry banner, the post-checkout confirmation
// banner, the tier-2 reserved-height placeholder, and the local-dev
// not-configured note. Split out of BillingTab.tsx.
export function BillingStatusBanners({
  checkout,
  planName,
  loadError,
  onRetry,
  onRecheck,
  hasData,
  configured,
  showCheckoutRefresh = false,
  showCheckoutSupport = false,
}: {
  checkout: CheckoutBanner;
  planName: string;
  /** The localized reason the overview could not be read, or null. Resolved from the
   *  server's machine code by the tab — never the server's English `error` string. */
  loadError: string | null;
  onRetry: () => void;
  /** Re-read the overview from the unconfirmed banner, once the automatic poll
   *  window has closed. */
  onRecheck: () => void;
  hasData: boolean;
  configured: boolean;
  /** Show a 'Refresh plan status' button while the banner is still in the
   *  'confirming' state — fires 10 s after the checkout return. */
  showCheckoutRefresh?: boolean;
  /** Show a 'Contact support' mailto link while confirming — fires 30 s after
   *  the checkout return when the webhook is unusually slow. */
  showCheckoutSupport?: boolean;
}) {
  const t = useTranslations("billing");

  return (
    <>
      {checkout ? (
        <div
          role="status"
          aria-live="polite"
          className={`${PANEL} flex flex-wrap items-center gap-2.5 p-4 ${
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
          {/* Progressive recovery while the webhook is still landing: a Refresh button
              appears at 10 s so a paying customer isn't left with a frozen banner, and
              a support mailto link appears at 30 s for the long-tail slow-webhook case.
              The automatic poll backs off to a one-minute cap and then stops; once the
              window closes the banner moves to 'unconfirmed' and the recheck button
              below takes over. */}
          {checkout === "confirming" && showCheckoutRefresh ? (
            <button type="button" onClick={onRecheck} className={`${BTN_SECONDARY} h-8 shrink-0 px-3 text-sm`}>
              <RefreshCw size={14} aria-hidden />
              {t("checkoutRefresh")}
            </button>
          ) : null}
          {checkout === "confirming" && showCheckoutSupport ? (
            <a
              href={supportContactHref(t("checkoutSupportSubject"))}
              className="shrink-0 text-sm text-steel underline hover:text-ink"
            >
              {t("checkoutSupportLink")}
            </a>
          ) : null}
          {checkout === "unconfirmed" ? (
            <button type="button" onClick={onRecheck} className={`${BTN_SECONDARY} h-8 shrink-0 px-3 text-sm`}>
              <RefreshCw size={14} aria-hidden />
              {t("checkoutRecheck")}
            </button>
          ) : null}
        </div>
      ) : null}

      {loadError ? (
        <div className={`${PANEL_SUNKEN} flex flex-wrap items-center gap-3 p-4`}>
          <p role="alert" className="text-base text-coral">
            {loadError}
          </p>
          <button type="button" onClick={onRetry} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {/* Tier 2: the overview fetch is in flight and there is nothing to show yet.
          Hold the current-plan + usage panels' height so the page doesn't jump when
          they land, and stay invisible for 150ms so a warm response paints nothing at
          all. (Was two pulsing skeleton slabs.) */}
      {!hasData && loadError === null ? <div className="reveal-quiet min-h-[21rem]" aria-hidden /> : null}

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
