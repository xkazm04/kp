"use client";

import { ArrowRight, Infinity as InfinityIcon, Server } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";

// The Billing tab on a SELF-HOSTED install (`metered: false` — see
// app/_lib/billing/mode.ts). It replaces the current-plan card and the plan
// catalog entirely, because both would be lies here: there is no subscription,
// nothing is gated, and no button on this page could sell the operator anything.
//
// What it does NOT do is disappear. A blank Billing tab reads like a broken
// feature; this panel answers the question the operator actually came here with
// — "am I being limited?" — with a plain no, points at the Models tab (the only
// spend that is real on a self-hosted install is their own provider bill), and
// mentions the hosted option once, as information rather than an upsell.
//
// The Usage & cost section still renders below it: usage is recorded even while
// unmetered, and the operator's own AI ledger is the useful half of this tab.
export function BillingSelfHostPanel() {
  const t = useTranslations("billing");

  return (
    <div className="space-y-4">
      <div className={`${PANEL} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={META_LABEL}>{t("selfHost.eyebrow")}</p>
            <p className="mt-1 flex items-center gap-2 font-serif text-h2 text-ink">
              <Server size={20} className="shrink-0 text-moss" aria-hidden />
              {t("selfHost.title")}
            </p>
            <p className="mt-2 max-w-xl text-base text-steel">{t("selfHost.body")}</p>
          </div>
        </div>

        <div className={`${PANEL_SUNKEN} mt-4 flex items-start gap-2.5 p-3`}>
          <InfinityIcon size={16} className="mt-0.5 shrink-0 text-moss" aria-hidden />
          <p className="text-sm text-steel">{t("selfHost.meters")}</p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4">
          <Link href="/?tab=models" className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
            {t("selfHost.modelsCta")}
            <ArrowRight size={14} aria-hidden />
          </Link>
          <p className="text-sm text-steel">{t("selfHost.modelsNote")}</p>
        </div>
      </div>

      <div className={`${PANEL_SUNKEN} p-4`}>
        <p className="text-base font-medium text-ink">{t("selfHost.cloudTitle")}</p>
        {/* No CTA button here on purpose: the marketing site's pricing band lives at
            '/', which is gated behind the entered-workspace cookie — a link from
            inside the workspace would bounce the operator straight back here. The
            sentence carries the information; the hosted product is a search away. */}
        <p className="mt-1 max-w-xl text-sm text-steel">{t("selfHost.cloudBody")}</p>
      </div>
    </div>
  );
}
