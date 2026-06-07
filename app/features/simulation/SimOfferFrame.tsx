"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useSimulation } from "./SimulationProvider";

// Shows a candidate-facing page (offer or self-schedule) in a framed panel so the
// viewer watches the real candidate flow. Same-origin, so the driver can reach
// into the frame's document to dispatch a real click when needed.
//
// Responsive: the frame caps at 520px but shrinks on short viewports so it never
// clips under the sim bar. A shimmer skeleton stands in until the iframe's load
// event fires, so a slow candidate page never reads as a blank box. Escape always
// dismisses; clicking the backdrop dismisses too, but only while paused so a stray
// click mid-step doesn't tear down the flow.
export function SimOfferFrame() {
  const { frame, paused, closeFrame } = useSimulation();
  const [loaded, setLoaded] = useState(false);
  const url = frame?.url ?? null;

  // A fresh page is loading whenever the framed URL changes — reset the shimmer
  // DURING render (guarded render-phase adjustment) so the old page's "loaded"
  // state never paints for a frame against the new URL.
  const [prevUrl, setPrevUrl] = useState(url);
  if (url !== prevUrl) {
    setPrevUrl(url);
    setLoaded(false);
  }

  // Escape closes the overlay regardless of run state.
  useEffect(() => {
    if (!frame) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFrame();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frame, closeFrame]);

  if (!frame) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-[calc(var(--sim-bar-h)_+_8px)] z-[var(--z-sim-frame)] flex items-center justify-center bg-ink/45 p-6"
      onClick={paused ? closeFrame : undefined}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-stone-200 bg-paper px-3 py-2 text-sm">
          <span className="rounded-full bg-coral/15 px-2 py-0.5 text-meta font-semibold uppercase tracking-wide text-coral">
            {frame.title}
          </span>
          <span className="min-w-0 flex-1 truncate text-steel">{frame.url}</span>
          <button
            type="button"
            onClick={closeFrame}
            aria-label="Close candidate page"
            title="Close (Esc)"
            className="focus-ring -mr-1 shrink-0 rounded-md p-1 text-steel hover:bg-stone-100 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <div className="relative h-[min(520px,68vh)] w-full bg-paper">
          {!loaded ? (
            <div className="absolute inset-0 animate-pulse space-y-3 p-5 motion-reduce:animate-none" aria-hidden>
              <div className="h-6 w-2/3 rounded bg-stone-200" />
              <div className="h-3 w-1/2 rounded bg-stone-200/80" />
              <div className="mt-6 h-24 rounded-lg bg-stone-200/70" />
              <div className="h-3 w-5/6 rounded bg-stone-200/70" />
              <div className="h-3 w-3/4 rounded bg-stone-200/70" />
              <div className="mt-6 h-9 w-32 rounded-md bg-stone-200" />
            </div>
          ) : null}
          <iframe
            data-sim-frame
            src={frame.url}
            title="Candidate page"
            onLoad={() => setLoaded(true)}
            className={`h-full w-full bg-paper transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          />
        </div>
      </div>
    </div>
  );
}
