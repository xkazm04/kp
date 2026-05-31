"use client";

import { useSimulation } from "./SimulationProvider";

// Shows the candidate's ACTUAL offer page (/offer/[token]) in a framed panel so
// the driver can click "Accept offer" inside it — the viewer watches the real
// candidate-facing acceptance, not a mock. Same-origin, so the driver reaches
// into the frame's document to dispatch the real click.
export function SimOfferFrame() {
  const { offerUrl } = useSimulation();
  if (!offerUrl) return null;
  return (
    <div className="fixed inset-x-0 top-0 bottom-[68px] z-[48] flex items-center justify-center bg-ink/45 p-6">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-stone-200 bg-paper px-3 py-2 text-sm">
          <span className="rounded-full bg-coral/15 px-2 py-0.5 text-meta font-semibold uppercase tracking-wide text-coral">
            Candidate&apos;s view
          </span>
          <span className="truncate text-steel">{offerUrl}</span>
        </div>
        <iframe data-sim-offer src={offerUrl} title="Candidate offer page" className="h-[520px] w-full bg-paper" />
      </div>
    </div>
  );
}
