"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { checkoutBannerState } from "./billingCheckoutBanner";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { track } from "@/app/_lib/analytics/plausible";
import { Defer } from "@/app/_components/ui/Defer";
import { EYEBROW, INTRO } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { labelize } from "@/app/_lib/format";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { BillingCurrentPlanPanel } from "./BillingCurrentPlanPanel";
import { BillingSelfHostPanel } from "./BillingSelfHostPanel";
import { BillingStatusBanners } from "./BillingStatusBanners";
import {
  canStartPurchase,
  checkoutPollOffsetsMs,
  createLoadLatch,
  isCheckoutReturn,
  type Purchase,
} from "./billingTabState";
import { useBillingPortal } from "./useBillingPortal";
import { isUnmeteredInstall, type BillingPayload } from "./billingTypes";

// Tier 3 (docs/design/loading-choreography.md): the plan catalog + minutes pack is the
// heaviest, most-below-the-fold region of this tab (a card grid) — its own
// chunk, mounted an idle beat after the current-plan/usage panels above. The
// chunk gap is a quiet reserved box, never a skeleton.
const PlanCatalog = dynamic(() => import("./BillingPlanCatalog").then((m) => ({ default: m.PlanCatalog })), {
  loading: () => <div className="reveal-quiet min-h-[20rem]" aria-hidden />,
});
// Usage & cost — the consolidated spend section that moved off the Models tab
// (spend/). Its own chunk and an idle mount: it owns two server reads of its
// own, and the plan card above it must not wait on them.
const SpendSection = dynamic(() => import("./spend/BillingSpendSection").then((m) => ({ default: m.BillingSpendSection })), {
  loading: () => <div className="reveal-quiet min-h-[22rem]" aria-hidden />,
});

// Billing tab — the GET /api/billing overview rendered for an OWNER: the entitled
// plan, this period's meter usage (included allowance + pack credits), the plan
// catalog with checkout, the minute top-up pack, and the provider portal.
// Checkout/portal URLs come from the server; the client only redirects —
// entitlement always lands via the webhook, never from here.
//
// Every door behind this tab requires `org:manage` (app/api/billing/authority.ts),
// so a seated non-owner is answered 403 + BILLING_ORG_MANAGE_REQUIRED and reads that
// reason, in their own language, in the failure banner below — not a bare
// "couldn't load".
//
// The state machine (newest-read latch, single-flight purchase, the once-only return
// capture, the poll schedule) lives in billingTabState.ts, pure and unit-tested.

export function BillingTab() {
  const t = useTranslations("billing");
  // API failures render from the machine `code`, never from the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [data, setData] = useState<BillingPayload | null>(null);
  // The localized reason the overview could not be read (a capability refusal, a
  // store fault), or null. Was a bare boolean, which threw away the code the server
  // had just computed and rendered one generic sentence for every cause.
  const [loadError, setLoadError] = useState<string | null>(null);
  // One purchase at a time: which catalog item (plan/pack id) is checking out,
  // and its inline error. A successful checkout leaves the entry standing — the
  // page is about to navigate to the provider-hosted form.
  const [purchase, setPurchase] = useState<Purchase>(null);
  const { portalBusy, portalNote, openPortal } = useBillingPortal();
  // Self-hosted (AGPL) install: no billing provider, no billing history, nothing
  // gated (app/_lib/billing/mode.ts). The plan card, the catalog and the
  // not-configured note are all replaced by one honest panel — see
  // BillingSelfHostPanel for why it isn't simply hidden. Defaults to metered
  // while `data` is null so a hosted deploy never flashes the self-host panel.
  // The predicate itself lives in billingTypes.ts (named, tested, quotable) —
  // it now decides the page header too, and two copies of "is this metered?"
  // is exactly how the two halves of this tab would drift apart.
  const selfHosted = isUnmeteredInstall(data);
  // Post-checkout return: the provider redirected to /?tab=billing&billing=success.
  // The flag is captured ONCE via lazy initial state (render-derived and sticky, so
  // it survives the URL cleanup below) rather than a synchronous setState in the
  // mount effect. `useSearchParams` reads the same value on the server and during
  // hydration, so the "confirming" banner paints without a mismatch.
  const searchParams = useSearchParams();
  const [checkoutReturn] = useState(() => isCheckoutReturn(searchParams.get("billing")));
  // The automatic poll window elapsed — NOT "the plan is confirmed". Confirmation is
  // derived from the real billing state below, so a timer alone can never assert a
  // plan grant; once this flips, the banner offers a manual re-check.
  const [pollWindowElapsed, setPollWindowElapsed] = useState(false);
  // Progressive recovery affordances shown while the banner is in the "confirming"
  // state: a Refresh button after 10 s, a support link after 30 s.  Both are
  // independent of the poll-window timer — the poll may still be running when they
  // appear, and they stay visible if the poll window closes without a confirmed plan.
  const [showCheckoutRefresh, setShowCheckoutRefresh] = useState(false);
  const [showCheckoutSupport, setShowCheckoutSupport] = useState(false);
  // The banner is bound to the ACTUAL billing state, not the timer: we only claim
  // "your plan is now X" once /api/billing reflects a paid plan (plans-checkout #2).
  const checkout = checkoutBannerState({
    isCheckoutReturn: checkoutReturn,
    pollWindowElapsed,
    planReflectsPaid: Boolean(data && data.plan.id !== "free"),
  });

  // Only the NEWEST /api/billing read may land — see billingTabState.ts.
  const latch = useRef(createLoadLatch()).current;
  // State updates only happen in the async callbacks (never synchronously in
  // the effect body); the retry button clears the failure in its event handler
  // before re-firing.
  const load = useCallback(() => {
    const seq = latch.begin();
    fetch("/api/billing")
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { code?: string; error?: string };
          // The reason is the server's CODE, resolved in the reader's language: a
          // recruiter who is simply not an owner should read that, not "try again".
          throw new Error(errMsg(body, t("loadFailed")));
        }
        return (await r.json()) as BillingPayload;
      })
      .then((p) => {
        if (latch.isCurrent(seq)) {
          setData(p);
          setLoadError(null);
        }
      })
      // A superseded read's failure is not this view's failure either: a newer
      // load is already in flight (or has landed), so it owns the outcome.
      .catch((e: unknown) => {
        if (latch.isCurrent(seq)) setLoadError(e instanceof Error ? e.message : t("loadFailed"));
      });
  }, [errMsg, latch, t]);
  useEffect(() => {
    load();
  }, [load]);

  // Progressive recovery: show the Refresh button at 10 s and the support link at
  // 30 s from the checkout return, so paying customers are never left staring at a
  // frozen "confirming" message with no resolution path.  Timers are unconditional
  // on mount so they fire even when the poll finishes early (both checks are cheap
  // and the banner guards visibility by checkout state).
  useEffect(() => {
    if (!checkoutReturn) return;
    const t10 = setTimeout(() => setShowCheckoutRefresh(true), 10_000);
    const t30 = setTimeout(() => setShowCheckoutSupport(true), 30_000);
    return () => {
      clearTimeout(t10);
      clearTimeout(t30);
    };
  }, [checkoutReturn]);

  // On a checkout return, re-poll the overview (the entitlement lands via the
  // webhook a beat after redirect) with a BACKOFF to a stated one-minute cap, then
  // hand over to the banner's manual re-check. It used to fire three fixed shots and
  // stop forever, stranding a buyer whose webhook was merely slow. Runs once on
  // mount; the banner itself is derived above.
  useEffect(() => {
    if (!checkoutReturn) return;
    const offsets = checkoutPollOffsetsMs();
    const timers = offsets.map((at, i) =>
      setTimeout(() => {
        load();
        // Marks the automatic window closed, NOT the plan confirmed — the banner only
        // claims success once `data.plan` actually reflects it (checkoutBannerState).
        if (i === offsets.length - 1) setPollWindowElapsed(true);
      }, at)
    );
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
    if (!canStartPurchase(purchase)) return; // redirect already in flight
    // Fire-and-forget analytics (no-op when Plausible isn't configured): the
    // checkout intent, before the provider redirect can navigate away.
    track("checkout_started", { item: key });
    setPurchase({ key, error: null });
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const p = (await r.json().catch(() => ({}))) as { url?: string; error?: string; code?: string };
      // Every checkout refusal now carries a BILLING_* code, so the actionable reason
      // ("use the portal", "that tier is withdrawn", "you are not an owner") survives
      // to the card instead of collapsing into one generic failure.
      if (!r.ok || !p.url) throw new Error(errMsg(p, t("plans.checkoutFailed")));
      window.location.assign(p.url);
    } catch (e) {
      setPurchase({ key, error: e instanceof Error ? e.message : t("plans.checkoutFailed") });
    }
  };

  return (
    // Tier 1: the header + whatever has arrived cascade in as this section's
    // direct children (stagger-children, globals.css). aria-busy covers the
    // first load only — a later refresh never blanks what is already here.
    <section className="stagger-children space-y-6" aria-busy={!data && loadError === null}>
      {/* The metered header promises three things — "your subscription, what this
          period has used, and the plans you can move to" — and on a self-hosted
          install two of them do not exist: there is no subscription and the plan
          catalog below is not rendered at all. The panel two lines down already
          says so in plain words, so the header said the opposite of the page.
          Self-hosted gets its own title/intro, in the self-host panel's voice.

          The EYEBROW stays "Billing" in both: it is wayfinding — it must keep
          naming the tab the reader clicked in the nav rail, not the content.

          Tension with loading-choreography law 1 ("chrome renders on the first
          frame"), stated rather than hidden: the client cannot know the metering
          mode until GET /api/billing lands, and there is no server-rendered seam
          on this tab to carry it. isUnmeteredInstall(null) is therefore metered,
          so the ONE frame of possibly-wrong wording lands on the self-hoster
          (who is told nothing false about money) and never on the paying
          customer. The swap is a plain text change in fixed geometry — no
          reflow, no placeholder, nothing to animate. */}
      <header>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <SectionTitle className="mt-1">{selfHosted ? t("selfHost.pageTitle") : t("title")}</SectionTitle>
        <p className={`mt-2 max-w-2xl ${INTRO}`}>{selfHosted ? t("selfHost.pageIntro") : t("intro")}</p>
      </header>

      {/* `configured` drives a "billing isn't configured, purchases disabled" note —
          a HOSTED-deploy misconfiguration warning. On a self-hosted install that same
          condition is the normal, intended state, so pass `true` to suppress it;
          BillingSelfHostPanel says the true thing in its place. */}
      <BillingStatusBanners
        checkout={checkout}
        planName={data?.plan.name ?? ""}
        loadError={loadError}
        onRetry={() => {
          setLoadError(null);
          load();
        }}
        onRecheck={load}
        hasData={data !== null}
        configured={selfHosted ? true : (data?.configured ?? true)}
        showCheckoutRefresh={showCheckoutRefresh}
        showCheckoutSupport={showCheckoutSupport}
      />

      {selfHosted ? <BillingSelfHostPanel /> : null}

      {data && !selfHosted ? (
        <BillingCurrentPlanPanel
          data={data}
          statusLabel={statusLabel}
          onManage={openPortal}
          portalBusy={portalBusy}
          portalNote={portalNote}
        />
      ) : null}

      {/* Tier 3: the consolidated Usage & cost section — this period's allowance
          meters, the per-use-case AI ledger and the engine facts, in ONE surface. */}
      {data ? (
        <Defer strategy="idle" placeholder={<div className="reveal-quiet min-h-[22rem]" aria-hidden />}>
          <SpendSection data={data} meterName={meterName} />
        </Defer>
      ) : null}

      {/* Tier 3: the plan catalog + minutes pack, one idle beat after the primary
          panels paint. Its own chunk (BillingPlanCatalog.tsx), so this tab's entry
          payload is the current plan + usage meters only. */}
      {data && !selfHosted ? (
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
