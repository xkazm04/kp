"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { PlanDef } from "@/app/_lib/billing";
import { planPriceKind } from "./billingPlanPriceKind";

// Shared plan-price renderer — the ONE place the "custom / free / paid" decision is
// turned into markup, used by BOTH the current-plan header and each catalog card so
// they can never diverge. bug-ui-scan-2026-07-09 (plans-checkout-billing-ui #5): the
// header used to branch on `priceCzk === 0` alone and printed "Free" for Enterprise
// (a contact-sales tier whose priceCzk is a 0 sentinel). `size` only tunes the primary
// line's typography; the branching (contactSales → Custom, 0 → Free, else CZK+≈USD) is
// identical on both surfaces. Split out of BillingTab.tsx.
export function PlanPrice({
  plan,
  size,
}: {
  plan: Pick<PlanDef, "contactSales" | "priceCzk" | "priceUsdApprox">;
  size: "header" | "card";
}) {
  const t = useTranslations("billing.plans");
  const format = useFormatter();
  const price = planPriceKind(plan);
  const primary = size === "card" ? "mt-1 text-h2 font-semibold text-ink" : "mt-0.5 text-base text-ink";
  if (price.kind === "custom") {
    return (
      <>
        <p className={primary}>{t("custom")}</p>
        <p className="text-sm text-steel">{t("contactNote")}</p>
      </>
    );
  }
  if (price.kind === "free") {
    return <p className={`${primary} nums`}>{t("priceFree")}</p>;
  }
  return (
    <>
      <p className={`${primary} nums`}>
        {format.number(price.czk, { style: "currency", currency: "CZK", maximumFractionDigits: 0 })}
      </p>
      <p className="text-sm text-steel">
        {t("approxUsd", {
          price: format.number(price.usdApprox, { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
        })}{" "}
        · {t("perMonth")}
      </p>
    </>
  );
}
