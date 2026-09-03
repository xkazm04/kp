"use client";

import { Timer } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { BTN_SECONDARY, DIVIDER, PANEL } from "@/app/_components/ui/recipes";
import { salesContactHref } from "@/app/_lib/sales-contact";
import type { PlanDef } from "@/app/_lib/billing";
import { PlanPrice } from "./BillingPlanPrice";
import { planChangeVia, type BillingPayload } from "./billingTypes";

// Tier 3 (docs/design/loading-choreography.md): the plan catalog + minutes pack is the
// heaviest, most-below-the-fold part of Billing — a grid of cards nobody needs
// to see before the current-plan/usage panels above. Split into its own chunk
// so the tab's entry payload is the current plan + usage meters alone.

// One catalog plan: price (CZK primary, USD approximate), per-meter allowance, and
// an action. `changeVia` decides that action: a customer with NO active paid plan
// gets a fresh CHECKOUT (first subscription); a customer who already has a paid plan
// must change it through the provider PORTAL (in-place swap / proration), never a
// second checkout — a fresh checkout for a downgrade/cross-grade could mint a
// PARALLEL subscription and double-charge them. The free tier never has a button.
function PlanCard({
  plan,
  current,
  configured,
  busy,
  error,
  changeVia,
  meterName,
  onChoose,
  onManage,
}: {
  plan: PlanDef;
  current: boolean;
  configured: boolean;
  busy: boolean;
  error: string | null;
  changeVia: "checkout" | "portal";
  meterName: (meter: string) => string;
  onChoose: () => void;
  onManage: () => void;
}) {
  const t = useTranslations("billing.plans");
  return (
    // The CURRENT plan is the same panel surface with the brand accent swapped in:
    // composed from the recipe rather than a second hand-typed copy of it, which
    // would drift the day PANEL gains a shadow or a dark-mode radius.
    <div className={`${PANEL} p-4 ${current ? "border-coral/40 bg-coral/5 dark:rounded-2xl" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-serif text-h3 text-ink">{plan.name}</p>
        {current ? <Badge tone="positive" label={t("current")} className="shrink-0" /> : null}
      </div>
      {/* plans-checkout-billing-ui #5: price via the shared renderer so this card and
          the current-plan header apply the SAME contactSales-first rule. */}
      <PlanPrice plan={plan} size="card" />
      <ul className={`mt-3 space-y-1 ${DIVIDER} pt-3 text-sm`}>
        {Object.entries(plan.limits).map(([meter, limit]) => (
          <li key={meter} className="flex items-baseline justify-between gap-2">
            <span className="text-steel">{meterName(meter)}</span>
            <span className="font-medium text-ink nums">{limit === null ? t("unlimited") : limit}</span>
          </li>
        ))}
      </ul>
      {plan.contactSales ? (
        // Enterprise is never bought here — route to a real sales contact instead of
        // a Buy button. If they're somehow already entitled (a signed contract), the
        // "current" badge above is enough; no action needed.
        current ? null : (
          <a href={salesContactHref()} className={`${BTN_SECONDARY} mt-3 h-9 w-full justify-center px-3 text-sm`}>
            {t("contactCta")}
          </a>
        )
      ) : current || plan.id === "free" ? null : changeVia === "portal" ? (
        // Already subscribed: route the change through the provider portal so it's an
        // in-place swap, not a parallel subscription.
        <button
          type="button"
          onClick={onManage}
          disabled={!configured}
          className={`${BTN_SECONDARY} mt-3 h-9 w-full justify-center px-3 text-sm`}
        >
          {t("manageCta")}
        </button>
      ) : (
        <button
          type="button"
          onClick={onChoose}
          disabled={!configured || busy}
          className={`${BTN_SECONDARY} mt-3 h-9 w-full justify-center px-3 text-sm`}
        >
          {busy ? t("redirecting") : t("cta")}
        </button>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-coral">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function PlanCatalog({
  data,
  purchase,
  meterName,
  onChoosePlan,
  onManage,
  onBuyPack,
}: {
  data: BillingPayload;
  purchase: { key: string; error: string | null } | null;
  meterName: (meter: string) => string;
  onChoosePlan: (planId: string) => void;
  onManage: () => void;
  onBuyPack: () => void;
}) {
  const t = useTranslations("billing");
  const format = useFormatter();
  // The server's checkout guard reads the RAW subscription status, not the entitled
  // plan — planChangeVia (billingTypes.ts) mirrors that rule so this catalog never
  // offers a Buy button the route will 403.
  const changeVia = planChangeVia(data);

  return (
    <div>
      <h3 className="font-serif text-h3 text-ink">{t("plans.title")}</h3>
      <p className="mt-1 max-w-2xl text-sm text-steel">{t("plans.intro")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Object.values(data.catalog.plans)
          // A LEGACY tier (withdrawn from sale — see plans.ts) is hidden from the
          // catalog, EXCEPT for the customer who is on it: they still need to see
          // what they hold, what it includes, and the portal link to change it.
          // Hiding it from them too would make their own plan invisible.
          .filter((plan) => !plan.legacy || plan.id === data.plan.id)
          .map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            current={plan.id === data.plan.id}
            configured={data.configured}
            busy={purchase?.key === plan.id && purchase.error === null}
            error={purchase?.key === plan.id ? purchase.error : null}
            // A customer whose provider subscription is still LIVE changes it
            // through the portal (no parallel-subscription double-charge); with no
            // subscription, the first one is a normal checkout. Derived from the raw
            // status, not the entitled plan — a lapsed past_due/unpaid row entitles
            // free while the MoR is still dunning the live subscription.
            changeVia={changeVia}
            meterName={meterName}
            onChoose={() => onChoosePlan(plan.id)}
            onManage={onManage}
          />
        ))}
      </div>

      {data.catalog.packs.minutes_100 ? (
        <div className={`${PANEL} mt-3 p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Timer size={18} className="mt-0.5 shrink-0 text-coral" aria-hidden />
              <div>
                <p className="font-medium text-ink">{t("pack.title")}</p>
                <p className="mt-0.5 max-w-xl text-sm text-steel">{t("pack.intro")}</p>
                <p className="mt-1 text-sm text-ink nums">
                  {t("pack.minutes", { qty: data.catalog.packs.minutes_100.qty })} ·{" "}
                  <span className="font-semibold">
                    {format.number(data.catalog.packs.minutes_100.priceCzk, {
                      style: "currency",
                      currency: "CZK",
                      maximumFractionDigits: 0,
                    })}
                  </span>{" "}
                  <span className="text-steel">
                    {t("plans.approxUsd", {
                      price: format.number(data.catalog.packs.minutes_100.priceUsdApprox, {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 0,
                      }),
                    })}
                  </span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onBuyPack}
              disabled={!data.configured || (purchase?.key === "minutes_100" && purchase.error === null)}
              className={`${BTN_SECONDARY} h-9 shrink-0 px-3 text-sm`}
            >
              {purchase?.key === "minutes_100" && purchase.error === null ? t("plans.redirecting") : t("pack.buy")}
            </button>
          </div>
          {purchase?.key === "minutes_100" && purchase.error ? (
            <p role="alert" className="mt-2 text-sm text-coral">
              {purchase.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
