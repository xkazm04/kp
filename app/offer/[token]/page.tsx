"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { initials } from "@/app/_lib/initials";
import { offerHoursRemaining } from "@/app/_lib/offer-policy";

type OfferView = {
  token: string;
  status: "extended" | "accepted" | "declined" | "expired";
  jobTitle: string | null;
  candidateLabel: string | null;
  currency: string | null;
  salary: number | null;
  company: string | null;
  expiresAt: string | null;
};

// Public, token-gated offer page. The candidate accepts or declines here; accept
// drives the Hired transition + onboarding, decline closes the entry.
export default function OfferPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const t = useTranslations("offer");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const errMsg = useErrorMessage();
  const [offer, setOffer] = useState<OfferView | null>(null);
  // Two distinct failure modes, deliberately separated: a GET load failure has nothing to show,
  // so it replaces the whole card; a POST response failure surfaces as an inline banner that
  // PRESERVES the card + re-enables the buttons, so a transient blip on accept/decline isn't a dead end.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  // Which response is mid-flight, so we can spin the pressed button and mute the other.
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [result, setResult] = useState<"accepted" | "declined" | "expired" | null>(null);
  // Decline is terminal + irreversible (offer-finalize markEntryStatus 'declined'), so it
  // routes through a deliberate inline confirm step before the POST fires — a single
  // misclick must not permanently close the offer.
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const goBackRef = useRef<HTMLButtonElement>(null);

  // When the confirm step appears, move focus to the safe option so a keyboard user
  // lands on 'Go back' rather than the destructive default.
  useEffect(() => {
    if (confirmingDecline) goBackRef.current?.focus();
  }, [confirmingDecline]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/offer/${token}`)
      .then((r) => r.json())
      .then((p) => {
        if (p.error) throw new Error(p.error);
        setOffer(p.offer as OfferView);
        if (p.offer?.status === "accepted" || p.offer?.status === "declined" || p.offer?.status === "expired")
          setResult(p.offer.status);
      })
      .catch(() => setLoadError(t("loadFailed")));
  }, [token, t]);

  const respond = async (response: "accept" | "decline") => {
    setPending(response);
    setResponseError(null);
    try {
      const r = await fetch(`/api/offer/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const p = await r.json();
      if (!r.ok) {
        // 410 → the offer lapsed past its deadline (idea-29361408): swap to the
        // definite expired card rather than an inline retry error.
        if (r.status === 410) {
          setResult("expired");
          return;
        }
        // Prefer the server's stable error `code` (localized via the errors
        // catalog); fall back to the page's own localized respond-failed message.
        setResponseError(errMsg(p, t("respondFailed")));
        return;
      }
      setResult(p.status as "accepted" | "declined");
    } catch {
      setResponseError(t("respondFailed"));
    } finally {
      setPending(null);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-stone-200 bg-white shadow-panel">
        {/* Brand accent — a premium letterhead strip so the offer reads as official. */}
        <div className="h-1.5 bg-gradient-to-r from-steel via-steel to-coral" aria-hidden="true" />
        <div className="p-7">
        {loadError ? (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{loadError}</p>
        ) : !offer ? (
          <p className="text-center text-sm text-steel">{tCommon("loading")}</p>
        ) : (
          <>
            {offer.company ? (
              <header className="flex items-center gap-3">
                {/* Logo slot — monogram stand-in until a real logo asset exists. */}
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-steel font-serif text-base font-semibold text-white"
                  aria-hidden="true"
                >
                  {initials(offer.company, "•")}
                </span>
                <div className="min-w-0">
                  <p className="text-meta uppercase tracking-wide text-coral">{t("eyebrow")}</p>
                  <p className="truncate font-serif text-lg text-ink">{offer.company}</p>
                </div>
              </header>
            ) : (
              <p className="text-meta uppercase tracking-wide text-coral">{t("eyebrow")}</p>
            )}
            <h1 className="mt-4 font-serif text-2xl text-ink">
              {offer.jobTitle ?? (offer.company ? t("roleAt", { company: offer.company }) : t("roleGeneric"))}
            </h1>
            {offer.candidateLabel ? (
              <p className="mt-1 text-sm text-steel">{t("preparedFor", { name: offer.candidateLabel })}</p>
            ) : null}

            {offer.salary ? (
              <div className="mt-4 rounded-lg border border-stone-200 bg-paper/60 p-4">
                <p className="text-meta uppercase tracking-wide text-steel">{t("compensation")}</p>
                <p className="mt-0.5 font-serif text-3xl text-ink">
                  {offer.salary.toLocaleString(locale)} <span className="text-lg text-steel">{offer.currency ?? "CZK"}</span>
                </p>
              </div>
            ) : null}

            {result === "accepted" ? (
              <div className="mt-6 rounded-lg bg-moss/10 p-4 text-center">
                <p className="text-lg font-semibold text-moss">{t("acceptedTitle")}</p>
                <p className="mt-1 text-sm text-steel">
                  {offer.company ? t("acceptedBodyCompany", { company: offer.company }) : t("acceptedBodyGeneric")}
                </p>
              </div>
            ) : result === "declined" ? (
              <div className="mt-6 rounded-lg bg-stone-100 p-4 text-center">
                <p className="text-base font-semibold text-ink">{t("declinedTitle")}</p>
                <p className="mt-1 text-sm text-steel">{t("declinedBody")}</p>
              </div>
            ) : result === "expired" ? (
              // The offer lapsed past its deadline (idea-29361408) — a definite
              // dead-end state, not an error the candidate can retry past.
              <div className="mt-6 rounded-lg bg-stone-100 p-4 text-center">
                <p className="text-base font-semibold text-ink">{t("expiredTitle")}</p>
                <p className="mt-1 text-sm text-steel">{t("expiredBody")}</p>
              </div>
            ) : (
              <>
                <p className="mt-5 text-sm text-steel">
                  {offer.company ? t("prompt", { company: offer.company }) : t("promptGeneric")}
                </p>
                {/* Deadline countdown (idea-29361408): the offer's lever to force a
                    timely decision. Turns coral inside the final 48h. */}
                {(() => {
                  const hrs = offerHoursRemaining(offer.expiresAt);
                  if (hrs === null || !offer.expiresAt) return null;
                  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                    new Date(offer.expiresAt)
                  );
                  return (
                    <p className={`mt-2 text-sm font-medium ${hrs <= 48 ? "text-coral" : "text-steel"}`}>
                      {t("deadline", { date })} {t("deadlineHours", { hours: hrs })}
                    </p>
                  );
                })()}
                {/* POST failure: inline + retryable. The card and buttons below stay put. */}
                {responseError ? (
                  <p
                    role="alert"
                    className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                  >
                    {responseError}
                  </p>
                ) : null}
                {confirmingDecline ? (
                  <div
                    role="alertdialog"
                    aria-labelledby="decline-confirm-title"
                    aria-describedby="decline-confirm-desc"
                    className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-4"
                  >
                    <p id="decline-confirm-title" className="text-base font-semibold text-ink">
                      {t("declineConfirmTitle")}
                    </p>
                    <p id="decline-confirm-desc" className="mt-0.5 text-sm text-steel">
                      {t("declineConfirmBody")}
                    </p>
                    <div className="mt-3 flex gap-3">
                      <button
                        type="button"
                        data-sim-click="offer-decline-confirm"
                        onClick={() => respond("decline")}
                        disabled={pending !== null}
                        aria-busy={pending === "decline"}
                        className="focus-ring inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-coral text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                      >
                        {pending === "decline" ? (
                          <>
                            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                            {t("recording")}
                          </>
                        ) : (
                          t("confirm")
                        )}
                      </button>
                      <button
                        ref={goBackRef}
                        type="button"
                        onClick={() => setConfirmingDecline(false)}
                        disabled={pending !== null}
                        className="focus-ring inline-flex h-11 items-center justify-center rounded-md border border-stone-200 px-4 text-base font-semibold text-steel transition-opacity hover:bg-stone-50 disabled:opacity-60"
                      >
                        {t("goBack")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      data-sim-click="offer-accept"
                      onClick={() => respond("accept")}
                      disabled={pending !== null}
                      aria-busy={pending === "accept"}
                      className={`focus-ring inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-moss text-base font-semibold text-white transition-opacity hover:opacity-90 ${
                        pending === "decline" ? "opacity-40" : ""
                      }`}
                    >
                      {pending === "accept" ? (
                        <>
                          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                          {t("recording")}
                        </>
                      ) : (
                        t("accept")
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDecline(true)}
                      disabled={pending !== null}
                      className={`focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md border border-stone-200 px-4 text-base font-semibold text-steel transition-opacity hover:bg-stone-50 ${
                        pending === "accept" ? "opacity-40" : ""
                      }`}
                    >
                      {t("decline")}
                    </button>
                  </div>
                )}
              </>
            )}
            {!result ? <AiDisclosure className="mt-5" /> : null}
          </>
        )}
        </div>
      </div>
    </main>
  );
}
