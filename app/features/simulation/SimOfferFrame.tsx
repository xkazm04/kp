"use client";

import { useSimulation } from "./SimulationProvider";

// Shows a candidate-facing page (offer or self-schedule) in a framed panel so the
// viewer watches the real candidate flow. Same-origin, so the driver can reach
// into the frame's document to dispatch a real click when needed.
export function SimOfferFrame() {
  const { frame } = useSimulation();
  if (!frame) return null;
  return (
    <div className="fixed inset-x-0 top-0 bottom-[68px] z-[48] flex items-center justify-center bg-ink/45 p-6">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-stone-200 bg-paper px-3 py-2 text-sm">
          <span className="rounded-full bg-coral/15 px-2 py-0.5 text-meta font-semibold uppercase tracking-wide text-coral">
            {frame.title}
          </span>
          <span className="truncate text-steel">{frame.url}</span>
        </div>
        <iframe data-sim-frame src={frame.url} title="Candidate page" className="h-[520px] w-full bg-paper" />
      </div>
    </div>
  );
}
