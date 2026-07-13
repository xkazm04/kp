"use client";

import { useCallback, useEffect, useState } from "react";
import { checkoutBannerState } from "./checkout-banner";
import { planPriceKind } from "./plan-price";
import { portalOutcome } from "./portal-open";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Timer } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/app/_components/Badge";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_SECONDARY, EYEBROW, INTRO, META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { labelize } from "@/app/_lib/format";
import { salesContactHref } from "@/app/_lib/sales-contact";
import type { BillingOverview, MeterOverview, PlanDef } from "@/app/_lib/billing";

// Billing tab — the GET /api/billing overview rendered for a recruiter: the
// entitled plan, this period's meter usage (included allowance + pack credits),
// the plan catalog with checkout, the minute top-up pack, and the provider
// portal. Checkout/portal URLs come from the server; the client only redirects
// — entitlement always lands via the webhook, never from here.

// Shape of GET /api/billing: the entitlements overview plus the static catalog
// and whether the payment provider is wired (false = unbilled local dev).
// PackDef isn't part of the billing module's public surface (index.ts), so the
// pack's wire shape is mirrored here type-only.
type PackInfo = { id: string; name: string; meter: string; qty: number; priceCzk: number; priceUsdApprox: number };
type BillingPayload = BillingOverview & {
  configured: boolean;
  catalog: { plans: Record<string, PlanDef>; packs: { minutes_100?: PackInfo } };
};

// Subscription lifecycle -> badge tone. Unknown statuses (provider drift) fall
// back to neutral with the raw value labelized, never silently masked.
const STATUS_TONE: Record<string, BadgeTone> = {
  active: "positive",
  trialing: "info",
  past_due: "caution",
  canceled: "critical",
  none: "neutral",
};

// One usage meter: name, used-vs-limit progress bar, pack credits, and the
// over-quota flag. A null limit is the BYOM "unlimited" state — no bar, just
// the running count.
function MeterRow({ meter, name }: { meter: MeterOverview; name: string }) {
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

// Shared plan-price renderer — the ONE place the "custom / free / paid" decision is
// turned into markup, used by BOTH the current-plan header and each catalog card so
// they can never diverge. bug-ui-scan-2026-07-09 (plans-checkout-billing-ui #5): the
// header used to branch on `priceCzk === 0` alone and printed "Free" for Enterprise
// (a contact-sales tier whose priceCzk is a 0 sentinel). `size` only tunes the primary
// line's typography; the branching (contactSales → Custom, 0 → Free, else CZK+≈USD) is
// identical on both surfaces.
function PlanPrice({
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
    <div className={current ? "rounded-lg border border-coral/40 bg-coral/5 p-4 dark:rounded-2xl" : `${PANEL} p-4`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-serif text-h3 text-ink">{plan.name}</p>
        {current ? <Badge tone="positive" label={t("current")} className="shrink-0" /> : null}
      </div>
      {/* plans-checkout-billing-ui #5: price via the shared renderer so this card and
          the current-plan header apply the SAME contactSales-first rule. */}
      <PlanPrice plan={plan} size="card" />
      <ul className="mt-3 space-y-1 border-t border-stone-200 pt-3 text-sm">
        {Object.entries(plan.limits).map(([meter, limit]) => (
          <li key={meter} className="flex items-baseline justify-between gap-2">
            <span className="text-steel">{meterName(meter)}</span>
            <span className="font-medium text-ink nums">{limit === null ? t("unlimited") : limit}</span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-2">
          <span className="text-steel">{t("activeJobs")}</span>
          <span className="font-medium text-ink nums">{plan.activeJobs === null ? t("unlimited") : plan.activeJobs}</span>
        </li>
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

export function BillingTab() {
  const t = useTranslations("billing");
  const format = useFormatter();
  const [data, setData] = useState<BillingPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // One purchase at a time: which catalog item (plan/pack id) is checking out,
  // and its inline error. A successful checkout leaves `busy` standing — the
  // page is about to navigate to the provider-hosted form.
  const [purchase, setPurchase] = useState<{ key: string; error: string | null } | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  // `hint` renders calm (steel) — the portal's 404 means "no billing customer
  // yet", a normal pre-first-purchase state, not a failure. `url` is set only when a
  // popup blocker killed the pre-opened tab (plans-checkout-billing-ui #3): the note
  // then carries a clickable fallback link so the portal stays reachable.
  const [portalNote, setPortalNote] = useState<{ text: string; hint: boolean; url?: string } | null>(null);
  // Post-checkout return: the provider redirected to /?tab=billing&billing=success.
  // The flag is captured ONCE via lazy initial state (render-derived and sticky, so
  // it survives the URL cleanup below) rather than a synchronous setState in the
  // mount effect. `useSearchParams` reads the same value on the server and during
  // hydration, so the "confirming" banner paints without a mismatch.
  const searchParams = useSearchParams();
  const [checkoutReturn] = useState(() => searchParams.get("billing") === "success");
  // The poll window elapsed — NOT "the plan is confirmed". Confirmation is derived from
  // the real billing state below, so a timer alone can never assert a plan grant.
  const [pollWindowElapsed, setPollWindowElapsed] = useState(false);
  // The banner is bound to the ACTUAL billing state, not the timer: we only claim
  // "your plan is now X" once /api/billing reflects a paid plan (plans-checkout #2).
  const checkout = checkoutBannerState({
    isCheckoutReturn: checkoutReturn,
    pollWindowElapsed,
    planReflectsPaid: Boolean(data && data.plan.id !== "free"),
  });

  // State updates only happen in the async callbacks (never synchronously in
  // the effect body); the retry button clears the failure flag in its event
  // handler before re-firing.
  const load = useCallback(() => {
    fetch("/api/billing")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((p) => setData(p as BillingPayload))
      .catch(() => setLoadFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // On a checkout return, re-poll the overview (the entitlement lands via the
  // webhook a beat after redirect), mark done, and strip the flag so a refresh
  // doesn't re-trigger. Runs once on mount; the banner itself is derived above.
  useEffect(() => {
    if (!checkoutReturn) return;
    const timers = [
      setTimeout(load, 2000),
      setTimeout(load, 5000),
      // Marks the poll window closed, NOT the plan confirmed — the banner only claims
      // success once `data.plan` actually reflects it (see checkoutBannerState).
      setTimeout(() => setPollWindowElapsed(true), 5500),
    ];
    const url = new URL(window.location.href);
    url.searchParams.delete("billing");
    window.history.replaceState(null, "", url.toString());
    return () => timers.forEach(clearTimeout);
  }, [checkoutReturn, load]);

  // Catalog-key helpers with the app-wide has() fallback so an unknown enum
  // value (new meter, new provider status) renders labelized, never crashes.
  const meterName = (meter: string): string => {
    const key = `meters.${meter}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : labelize(meter);
  };
  const statusLabel = (status: string): string => {
    const key = `status.${status}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : labelize(status);
  };

  const startCheckout = async (body: { plan: string } | { pack: string }, key: string) => {
    if (purchase && purchase.error === null) return; // redirect already in flight
    setPurchase({ key, error: null });
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const p = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!r.ok || !p.url) throw new Error(p.error || t("plans.checkoutFailed"));
      window.location.assign(p.url);
    } catch (e) {
      setPurchase({ key, error: e instanceof Error ? e.message : t("plans.checkoutFailed") });
    }
  };

  const openPortal = async () => {
    if (portalBusy) return;
    setPortalBusy(true);
    setPortalNote(null);
    // bug-ui-scan-2026-07-09 (plans-checkout-billing-ui #3): pre-open the tab
    // SYNCHRONOUSLY, while we still hold the click's user-activation token — opening it
    // AFTER the fetch await let a popup blocker (Safari/Firefox strict, or any blocker)
    // swallow the click with zero feedback, so the customer couldn't reach the only
    // surface to cancel/downgrade/see invoices. We sever `opener` (about:blank inherits
    // our origin) to keep the security noopener/noreferrer gave — and we can't USE those
    // flags here because they force window.open to return null, which would make the
    // "was it blocked?" check impossible.
    const tab = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    if (tab) tab.opener = null;
    try {
      const r = await fetch("/api/billing/portal", { method: "POST" });
      const p = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      const outcome = portalOutcome({ status: r.status, ok: r.ok, url: p.url, error: p.error }, Boolean(tab));
      switch (outcome.kind) {
        case "navigate":
          tab!.location.href = outcome.url;
          break;
        case "fallback":
          // The synchronous pre-open was itself blocked: keep the portal reachable with a
          // clickable link instead of a dead, feedback-less click.
          setPortalNote({ text: t("portalBlocked"), hint: false, url: outcome.url });
          break;
        case "hint":
          tab?.close();
          setPortalNote({ text: t("noCustomerYet"), hint: true });
          break;
        case "error":
          tab?.close();
          setPortalNote({ text: outcome.message || t("portalFailed"), hint: false });
          break;
      }
    } catch (e) {
      tab?.close();
      setPortalNote({ text: e instanceof Error ? e.message : t("portalFailed"), hint: false });
    } finally {
      setPortalBusy(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <SectionTitle className="mt-1">{t("title")}</SectionTitle>
        <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
      </header>

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
              ? t("checkoutDone", { plan: data?.plan.name ?? "" })
              : checkout === "unconfirmed"
                ? t("checkoutPending")
                : t("checkoutConfirming")}
          </p>
        </div>
      ) : null}

      {loadFailed ? (
        <div className={`${PANEL_SUNKEN} flex flex-wrap items-center gap-3 p-4`}>
          <p className="text-base text-coral">{t("loadFailed")}</p>
          <button
            type="button"
            onClick={() => {
              setLoadFailed(false);
              load();
            }}
            className={`${BTN_SECONDARY} h-8 px-3 text-sm`}
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {!data && !loadFailed ? (
        <div role="status" aria-label={t("loading")} className="space-y-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      ) : null}

      {data ? (
        <>
          {/* Local-dev mode: the catalog still renders, purchases stay disabled. */}
          {!data.configured ? (
            <div className={`${PANEL_SUNKEN} flex items-start gap-2.5 p-3`}>
              <Info size={16} className="mt-0.5 shrink-0 text-steel" aria-hidden />
              <p className="text-sm text-steel">{t("notConfigured")}</p>
            </div>
          ) : null}

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
                onClick={openPortal}
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

          {/* Plan catalog + the one-off minutes pack. */}
          <div>
            <h3 className="font-serif text-h3 text-ink">{t("plans.title")}</h3>
            <p className="mt-1 max-w-2xl text-sm text-steel">{t("plans.intro")}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Object.values(data.catalog.plans).map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  current={plan.id === data.plan.id}
                  configured={data.configured}
                  busy={purchase?.key === plan.id && purchase.error === null}
                  error={purchase?.key === plan.id ? purchase.error : null}
                  // A customer who already holds a paid plan changes it through the
                  // portal (no parallel-subscription double-charge); from free, the
                  // first subscription is a normal checkout.
                  changeVia={data.plan.id === "free" ? "checkout" : "portal"}
                  meterName={meterName}
                  onChoose={() => startCheckout({ plan: plan.id }, plan.id)}
                  onManage={openPortal}
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
                    onClick={() => startCheckout({ pack: "minutes_100" }, "minutes_100")}
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
        </>
      ) : null}
    </section>
  );
}
