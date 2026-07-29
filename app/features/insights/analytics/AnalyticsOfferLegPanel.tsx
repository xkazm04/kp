"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { OfferConversion } from "@/app/_lib/analytics-offer";

// Direction 1 — the offer leg the funnel stops short of: of the offers EXTENDED,
// how many were accepted / declined / let expire. Folded server-side from the
// same windowed offer events; honesty-gated below the min-offers floor (a headline
// rate on a handful of offers would mislead). Deep-links to the candidates still
// sitting at the Offer stage — the only offer sub-population with a live board
// handle (accepted/declined/expired candidates have left the board). Split out of
// AnalyticsTab.tsx to keep that file under the 200-line cap.
export function OfferLegPanel({ offers, boardHref }: { offers: OfferConversion; boardHref: (filter: { q?: string; stage?: string }) => string }) {
  const t = useTranslations("analytics.offers");
  // No offers ever extended in this window → nothing to measure; stay silent
  // rather than render an empty scaffold.
  if (offers.extended === 0) return null;
  return (
    <div className="mt-4 border-t border-stone-200 pt-3">
      <p className="text-meta uppercase tracking-wide text-steel">{t("title")}</p>
      {!offers.enoughData ? (
        <p className="mt-1 text-sm text-steel">{t("notEnough", { n: offers.n, min: offers.minOffers })}</p>
      ) : (
        <>
          <p className="mt-1 font-serif text-h2 leading-tight text-moss">{t("headline", { pct: offers.acceptRatePct ?? 0 })}</p>
          <p className="mt-0.5 text-sm text-steel">{t("basis", { extended: offers.extended, accepted: offers.accepted })}</p>
          <ul className="mt-2 space-y-1 text-base">
            <li className="flex items-baseline justify-between gap-2">
              <span className="text-steel">{t("accepted")}</span>
              <span className="font-medium text-moss">{t("countPct", { count: offers.accepted, pct: offers.acceptRatePct ?? 0 })}</span>
            </li>
            <li className="flex items-baseline justify-between gap-2">
              <span className="text-steel">{t("declined")}</span>
              <span className="font-medium text-coral">{t("countPct", { count: offers.declined, pct: offers.declineRatePct ?? 0 })}</span>
            </li>
            <li className="flex items-baseline justify-between gap-2">
              <span className="text-steel">{t("expired")}</span>
              <span className="font-medium text-ink">{t("countPct", { count: offers.expired, pct: offers.expireRatePct ?? 0 })}</span>
            </li>
            {offers.pending > 0 ? (
              <li className="flex items-baseline justify-between gap-2">
                <span className="text-steel">{t("pending")}</span>
                {/* The only offer sub-population with a live board handle. */}
                <Link
                  href={boardHref({ stage: "Offer" })}
                  title={t("viewPending")}
                  className="focus-ring rounded font-medium text-ink underline-offset-2 hover:text-coral hover:underline"
                >
                  {offers.pending}
                </Link>
              </li>
            ) : null}
          </ul>
        </>
      )}
    </div>
  );
}
