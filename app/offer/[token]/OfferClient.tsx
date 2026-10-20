"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { DisclosureCompliance } from "@/app/_lib/compliance-regimes";
import { classifyOfferResponse, offerRespondAllowed } from "./offer-response";
import OfferKitView from "./kit/OfferKitView";

// The offer door's STATE: the load, the 60s + focus revalidation, the one-in-flight accept/decline
// guard, the 410 -> expired rule and the decline confirm step. Its markup is the composition-kit
// letter in ./kit (promoted at Gate 2 of the kit-unification spark, 2026-09-25), which renders this
// state and owns none of its own.

type OfferView = {
  token: string;
  status: "extended" | "accepted" | "declined" | "expired";
  jobTitle: string | null;
  candidateLabel: string | null;
  currency: string | null;
  salary: number | null;
  company: string | null;
  expiresAt: string | null;
  timeZone: string;
  // bug-ui-scan-2026-07-09 (offers-onboarding #5): whole-hours-left computed on the
  // SERVER at GET time so the countdown can't disagree with server-enforced expiry on a
  // skewed/back-dated client clock. Null when the offer carries no valid deadline.
  hoursRemaining: number | null;
  minutesRemaining: number | null;
  notes: string | null;
  startDate: string | null;
};

// Public, token-gated offer page. The candidate accepts or declines here; accept
// drives the Hired transition + onboarding, decline closes the entry.
export function OfferClient({
  compliance,
}: {
  /** The AI disclosure's regime + consent-retention window, resolved SERVER-side
   *  by page.tsx from the workspace that extended this offer. See the header of
   *  AiDisclosure.tsx for why a client fetch cannot get this right. */
  compliance: DisclosureCompliance;
}) {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const t = useTranslations("offer");
  const errMsg = useErrorMessage();
  const [offer, setOffer] = useState<OfferView | null>(null);
  // Two distinct failure modes, deliberately separated: a GET load failure has nothing to show,
  // so it replaces the whole card; a POST response failure surfaces as an inline banner that
  // PRESERVES the card + re-enables the buttons, so a transient blip on accept/decline isn't a dead end.
  const [loadError, setLoadError] = useState<string | null>(null);
  // A 404 (mistyped / revoked / non-existent token) is a DEAD link, not a transient
  // blip — surfaced as its own "invalid link, contact the team" card rather than the
  // generic retryable loadFailed.
  const [notFound, setNotFound] = useState(false);
  const [responseError, setResponseError] = useState<string | null>(null);
  // Which response is mid-flight, so we can spin the pressed button and mute the other.
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [result, setResult] = useState<"accepted" | "declined" | "expired" | null>(null);
  // Decline is terminal + irreversible (offer-finalize markEntryStatus 'declined'), so it
  // routes through a deliberate inline confirm step before the POST fires — a single
  // misclick must not permanently close the offer.
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const acceptedCardRef = useRef<HTMLDivElement>(null);

  // bug-ui-scan-2026-07-09 (offers-onboarding #4): on accept, move focus to the
  // confirmation itself. Paired with role=status/aria-live on the success card, a
  // screen-reader user hears the offer was accepted and their cursor lands on that
  // confirmation rather than silence after their most consequential action. The card
  // used to hold an onboarding next-step CTA and focus went there; accept is now the
  // terminal step on this surface, so the card (tabIndex -1) is the focus target.
  // Only when the accept happens in this session (a page loaded already-accepted
  // keeps natural order).
  useEffect(() => {
    if (result === "accepted") acceptedCardRef.current?.focus();
  }, [result]);

  // State is only written in the fetch's async callbacks (never synchronously
  // when the mount effect fires); every terminal branch settles BOTH failure
  // flags so a refetch (retry, locale switch) can't strand a stale one. The
  // retry button does its synchronous loading-state reset in its own handler.
  const load = useCallback(() => {
    if (!token) return;
    fetch(`/api/offer/${token}`)
      .then(async (r) => {
        const p = await r.json().catch(() => ({}));
        if (r.status === 404) {
          setNotFound(true);
          setLoadError(null);
          return;
        }
        if (!r.ok || p.error) {
          setLoadError(t("loadFailed"));
          setNotFound(false);
          return;
        }
        setLoadError(null);
        setNotFound(false);
        setOffer(p.offer as OfferView);
        const s = p.offer?.status;
        if (s === "accepted" || s === "declined" || s === "expired") setResult(s);
      })
      .catch(() => {
        setLoadError(t("loadFailed"));
        setNotFound(false);
      });
  }, [token, t]);

  // "Retry": clear the error and show the loading skeleton immediately (a
  // synchronous set is fine in an event handler), then refetch.
  const retryLoad = () => {
    setLoadError(null);
    setNotFound(false);
    load();
  };

  useEffect(() => {
    load();
  }, [load]);

  // Silent re-read of the AUTHORITATIVE view. Two callers: (1) after an ambiguous
  // POST (the request may have landed before the connection dropped) — if the server
  // already recorded the response, flip the card to it and clear the inline error, so
  // a candidate on a flaky phone isn't left unsure whether their accept/decline
  // registered; (2) the revalidation below, which keeps the SERVER-computed
  // hoursRemaining honest on a tab left open — the countdown is authored where the
  // expiry is enforced, but it was computed once at first load and never again, so
  // "12 hours left" sat on screen over an offer the server had already lapsed.
  //
  // Alarm is a budget on this page: a failed refresh NEVER replaces a rendered offer
  // (no setLoadError here — only the initial load owns that); a 404 is a definite
  // state change (the link was revoked) and may.
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`/api/offer/${token}`);
      const p = await r.json().catch(() => ({}));
      if (r.status === 404) {
        setNotFound(true);
        return;
      }
      if (!r.ok || !p?.offer) return;
      setOffer(p.offer as OfferView);
      const s = p.offer.status;
      if (s === "accepted" || s === "declined" || s === "expired") {
        setResult(s);
        setResponseError(null);
      }
    } catch {
      /* keep the last good view (and any responseError) so the candidate can retry */
    }
  }, [token]);

  // Revalidate on an interval and whenever the tab regains focus, and stop once the
  // outcome is terminal — a finished offer has nothing to advance to, and every
  // further fetch is a fresh chance to fail in front of someone whose story is over.
  // Mirrors StatusClient. Throttle math: GET /api/offer/[token] allows 60/min per
  // token+client; one poll a minute plus focus churn and manual reloads sits an order
  // of magnitude under it (pinned by app/offer/offer-revalidate.test.ts).
  const terminal = result !== null || notFound;
  useEffect(() => {
    if (!token || terminal) return;
    const POLL_MS = 60_000;
    const id = window.setInterval(() => void refresh(), POLL_MS);
    const revalidate = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
    };
  }, [token, terminal, refresh]);

  const respond = async (response: "accept" | "decline") => {
    // One in-flight response at a time: both outcomes are irreversible, and the
    // guard is asserted in offer-client-logic.test.ts rather than assumed.
    if (!offerRespondAllowed(pending)) return;
    setPending(response);
    setResponseError(null);
    try {
      const r = await fetch(`/api/offer/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const p = await r.json().catch(() => null);
      // What the answer MEANS is a pure decision (410 = a definite ending, not a
      // retry; a 2xx that names no recorded status is a failure, not a silent
      // success) and lives in offer-response.ts where a unit test can reach it.
      const outcome = classifyOfferResponse(r.status, p);
      if (outcome.kind === "settled") {
        setResult(outcome.status);
        return;
      }
      // The server's stable error `code`, localized via the errors catalog; its
      // English prose is never rendered (api-contracts.md 1.1).
      setResponseError(errMsg(outcome.code ? { code: outcome.code } : {}, t("respondFailed")));
      void refresh();
    } catch {
      setResponseError(t("respondFailed"));
      void refresh();
    } finally {
      setPending(null);
    }
  };

  return (
    <OfferKitView
      offer={offer}
      notFound={notFound}
      loadError={loadError}
      responseError={responseError}
      pending={pending}
      result={result}
      confirmingDecline={confirmingDecline}
      onRetry={retryLoad}
      onAccept={() => respond("accept")}
      onAskDecline={() => setConfirmingDecline(true)}
      onCancelDecline={() => setConfirmingDecline(false)}
      onConfirmDecline={() => respond("decline")}
      acceptedRef={acceptedCardRef}
      disclosure={
        !result ? <AiDisclosure regimeId={compliance.regimeId} retentionMonths={compliance.retentionMonths} /> : null
      }
    />
  );
}
