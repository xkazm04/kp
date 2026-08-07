"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { portalOutcome } from "./billingPortalOpen";

// The "Manage in portal" flow: pre-open a blank tab synchronously (so a popup
// blocker can't swallow the click with zero feedback), then navigate/fallback
// it once the server tells us where to go. Split out of BillingTab.tsx so the
// tab component doesn't carry this whole branch inline.
export function useBillingPortal() {
  const t = useTranslations("billing");
  // API failures render from the machine `code`, never from the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [portalBusy, setPortalBusy] = useState(false);
  // `hint` renders calm (steel) — the portal's 404 means "no billing customer
  // yet", a normal pre-first-purchase state, not a failure. `url` is set only when a
  // popup blocker killed the pre-opened tab (plans-checkout-billing-ui #3): the note
  // then carries a clickable fallback link so the portal stays reachable.
  const [portalNote, setPortalNote] = useState<{ text: string; hint: boolean; url?: string } | null>(null);

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
      const p = (await r.json().catch(() => ({}))) as { url?: string; error?: string; code?: string };
      const outcome = portalOutcome({ status: r.status, ok: r.ok, url: p.url, code: p.code }, Boolean(tab));
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
          setPortalNote({ text: errMsg({ code: outcome.code }, t("portalFailed")), hint: false });
          break;
      }
    } catch (e) {
      tab?.close();
      setPortalNote({ text: e instanceof Error ? e.message : t("portalFailed"), hint: false });
    } finally {
      setPortalBusy(false);
    }
  };

  return { portalBusy, portalNote, openPortal };
}
