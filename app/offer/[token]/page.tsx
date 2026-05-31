"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AiDisclosure } from "@/app/_components/AiDisclosure";

type OfferView = {
  token: string;
  status: "extended" | "accepted" | "declined";
  jobTitle: string | null;
  candidateLabel: string | null;
  currency: string | null;
  salary: number | null;
};

// Public, token-gated offer page. The candidate accepts or declines here; accept
// drives the Hired transition + onboarding, decline closes the entry.
export default function OfferPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [offer, setOffer] = useState<OfferView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"accepted" | "declined" | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/offer/${token}`)
      .then((r) => r.json())
      .then((p) => {
        if (p.error) throw new Error(p.error);
        setOffer(p.offer as OfferView);
        if (p.offer?.status === "accepted" || p.offer?.status === "declined") setResult(p.offer.status);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this offer."));
  }, [token]);

  const respond = async (response: "accept" | "decline") => {
    setBusy(true);
    setError(null);
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
      setError(e instanceof Error ? e.message : "Could not record your response.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-7 shadow-panel">
        {error ? (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : !offer ? (
          <p className="text-center text-sm text-steel">Loading…</p>
        ) : (
          <>
            <p className="text-meta uppercase tracking-wide text-coral">Your offer</p>
            <h1 className="mt-1 font-serif text-2xl text-ink">{offer.jobTitle ?? "A role with us"}</h1>
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
                  Wonderful — welcome aboard! Our People team will be in touch shortly with your onboarding details.
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
                  We&apos;d be thrilled to have you join us. Please let us know your decision below.
                </p>
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    data-sim-click="offer-accept"
                    onClick={() => respond("accept")}
                    disabled={busy}
                    className="focus-ring inline-flex h-11 flex-1 items-center justify-center rounded-md bg-moss text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Accept offer
                  </button>
                  <button
                    type="button"
                    onClick={() => respond("decline")}
                    disabled={busy}
                    className="focus-ring inline-flex h-11 items-center justify-center rounded-md border border-stone-200 px-4 text-base font-semibold text-steel hover:bg-stone-50 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </>
            )}
            {!result ? <AiDisclosure className="mt-5" /> : null}
          </>
        )}
      </div>
    </main>
  );
}
