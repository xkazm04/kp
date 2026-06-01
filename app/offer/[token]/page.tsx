"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AiDisclosure } from "@/app/_components/AiDisclosure";

type OfferView = {
  token: string;
  status: "extended" | "accepted" | "declined";
  jobTitle: string | null;
  candidateLabel: string | null;
  currency: string | null;
  salary: number | null;
  company: string | null;
};

// Monogram for the company logo slot — same initials convention used by the
// candidate avatars elsewhere in the app (e.g. PipelineShared/Avatar).
function companyInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase() || "•"
  );
}

// Public, token-gated offer page. The candidate accepts or declines here; accept
// drives the Hired transition + onboarding, decline closes the entry.
export default function OfferPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [offer, setOffer] = useState<OfferView | null>(null);
  // Two distinct failure modes, deliberately separated: a GET load failure has nothing to show,
  // so it replaces the whole card; a POST response failure surfaces as an inline banner that
  // PRESERVES the card + re-enables the buttons, so a transient blip on accept/decline isn't a dead end.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  // Which response is mid-flight, so we can spin the pressed button and mute the other.
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [result, setResult] = useState<"accepted" | "declined" | null>(null);
  // Decline is terminal + irreversible (offer-finalize markEntryStatus 'rejected'), so it
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
        if (p.offer?.status === "accepted" || p.offer?.status === "declined") setResult(p.offer.status);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load this offer."));
  }, [token]);

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
      if (!r.ok) throw new Error(p.error ?? "Could not record your response.");
      setResult(p.status as "accepted" | "declined");
    } catch (e) {
      setResponseError(e instanceof Error ? e.message : "Could not record your response.");
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
          <p className="text-center text-sm text-steel">Loading…</p>
        ) : (
          <>
            {offer.company ? (
              <header className="flex items-center gap-3">
                {/* Logo slot — monogram stand-in until a real logo asset exists. */}
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-steel font-serif text-base font-semibold text-white"
                  aria-hidden="true"
                >
                  {companyInitials(offer.company)}
                </span>
                <div className="min-w-0">
                  <p className="text-meta uppercase tracking-wide text-coral">Your offer</p>
                  <p className="truncate font-serif text-lg text-ink">{offer.company}</p>
                </div>
              </header>
            ) : (
              <p className="text-meta uppercase tracking-wide text-coral">Your offer</p>
            )}
            <h1 className="mt-4 font-serif text-2xl text-ink">
              {offer.jobTitle ?? (offer.company ? `A role at ${offer.company}` : "A role with us")}
            </h1>
            {offer.candidateLabel ? <p className="mt-1 text-sm text-steel">Prepared for {offer.candidateLabel}</p> : null}

            {offer.salary ? (
              <div className="mt-4 rounded-lg border border-stone-200 bg-paper/60 p-4">
                <p className="text-meta uppercase tracking-wide text-steel">Proposed compensation</p>
                <p className="mt-0.5 font-serif text-3xl text-ink">
                  {offer.salary.toLocaleString()} <span className="text-lg text-steel">{offer.currency ?? "CZK"}</span>
                </p>
              </div>
            ) : null}

            {result === "accepted" ? (
              <div className="mt-6 rounded-lg bg-moss/10 p-4 text-center">
                <p className="text-lg font-semibold text-moss">🎉 Offer accepted</p>
                <p className="mt-1 text-sm text-steel">
                  {offer.company ? `Welcome to ${offer.company}!` : "Wonderful — welcome aboard!"} Our People team will be in
                  touch shortly with your onboarding details.
                </p>
              </div>
            ) : result === "declined" ? (
              <div className="mt-6 rounded-lg bg-stone-100 p-4 text-center">
                <p className="text-base font-semibold text-ink">Response recorded</p>
                <p className="mt-1 text-sm text-steel">Thank you for letting us know. We wish you all the best.</p>
              </div>
            ) : (
              <>
                <p className="mt-5 text-sm text-steel">
                  We&apos;d be thrilled to have you join {offer.company ?? "us"}. Please let us know your decision below.
                </p>
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
                      Decline this offer?
                    </p>
                    <p id="decline-confirm-desc" className="mt-0.5 text-sm text-steel">
                      This cannot be undone.
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
                            Recording…
                          </>
                        ) : (
                          "Confirm"
                        )}
                      </button>
                      <button
                        ref={goBackRef}
                        type="button"
                        onClick={() => setConfirmingDecline(false)}
                        disabled={pending !== null}
                        className="focus-ring inline-flex h-11 items-center justify-center rounded-md border border-stone-200 px-4 text-base font-semibold text-steel transition-opacity hover:bg-stone-50 disabled:opacity-60"
                      >
                        Go back
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
                          Recording…
                        </>
                      ) : (
                        "Accept offer"
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
                      Decline
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
