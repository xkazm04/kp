"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { checkoutBannerState } from "./billingCheckoutBanner";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Defer } from "@/app/_components/ui/Defer";
import { EYEBROW, INTRO } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { labelize } from "@/app/_lib/format";
import { BillingCurrentPlanPanel } from "./BillingCurrentPlanPanel";
import { BillingStatusBanners } from "./BillingStatusBanners";
import { useBillingPortal } from "./useBillingPortal";
import type { BillingPayload } from "./billingTypes";

// Tier 3 (docs/LOADING_CHOREOGRAPHY.md): the plan catalog + minutes pack is the
// heaviest, most-below-the-fold region of this tab (a card grid) — its own
// chunk, mounted an idle beat after the current-plan/usage panels above. The
// chunk gap is a quiet reserved box, never a skeleton.
const PlanCatalog = dynamic(() => import("./BillingPlanCatalog").then((m) => ({ default: m.PlanCatalog })), {
  loading: () => <div className="reveal-quiet min-h-[20rem]" aria-hidden />,
});

// Billing tab — the GET /api/billing overview rendered for a recruiter: the
// entitled plan, this period's meter usage (included allowance + pack credits),
// the plan catalog with checkout, the minute top-up pack, and the provider
// portal. Checkout/portal URLs come from the server; the client only redirects
// — entitlement always lands via the webhook, never from here.

export function BillingTab() {
  const t = useTranslations("billing");
  const [data, setData] = useState<BillingPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // One purchase at a time: which catalog item (plan/pack id) is checking out,
  // and its inline error. A successful checkout leaves `busy` standing — the
  // page is about to navigate to the provider-hosted form.
  const [purchase, setPurchase] = useState<{ key: string; error: string | null } | null>(null);
  const { portalBusy, portalNote, openPortal } = useBillingPortal();
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

  return (
    // Tier 1: the header + whatever has arrived cascade in as this section's
    // direct children (stagger-children, globals.css). aria-busy covers the
    // first load only — a later refresh never blanks what is already here.
    <section className="stagger-children space-y-6" aria-busy={!data && !loadFailed}>
      <header>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <SectionTitle className="mt-1">{t("title")}</SectionTitle>
        <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
      </header>

      <BillingStatusBanners
        checkout={checkout}
        planName={data?.plan.name ?? ""}
        loadFailed={loadFailed}
        onRetry={() => {
          setLoadFailed(false);
          load();
        }}
        hasData={data !== null}
        configured={data?.configured ?? true}
      />

      {data ? (
        <BillingCurrentPlanPanel
          data={data}
          statusLabel={statusLabel}
          meterName={meterName}
          onManage={openPortal}
          portalBusy={portalBusy}
          portalNote={portalNote}
        />
      ) : null}

      {/* Tier 3: the plan catalog + minutes pack, one idle beat after the primary
          panels paint. Its own chunk (BillingPlanCatalog.tsx), so this tab's entry
          payload is the current plan + usage meters only. */}
      {data ? (
        <Defer strategy="idle" placeholder={<div className="reveal-quiet min-h-[20rem]" aria-hidden />}>
          <PlanCatalog
            data={data}
            purchase={purchase}
            meterName={meterName}
            onChoosePlan={(planId) => startCheckout({ plan: planId }, planId)}
            onManage={openPortal}
            onBuyPack={() => startCheckout({ pack: "minutes_100" }, "minutes_100")}
          />
        </Defer>
      ) : null}
    </section>
  );
}
