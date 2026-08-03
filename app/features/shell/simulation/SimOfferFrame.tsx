"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useSimulation } from "./SimulationProvider";

// Shows a candidate-facing page (offer or self-schedule) in a framed panel so the
// viewer watches the real candidate flow. Same-origin, so the driver can reach
// into the frame's document to dispatch a real click when needed.
//
// Responsive: the frame caps at 520px but shrinks on short viewports so it never
// clips under the sim bar. A shimmer skeleton stands in until the iframe's load
// event fires, so a slow candidate page never reads as a blank box. It is a real
// modal (role="dialog"/aria-modal, focus moved in on open) and is always dismissable
// — Escape, the visible Close button, or a backdrop click — so a viewer is never
// trapped behind the dim layer; closing just continues the demo via the API path.
export function SimOfferFrame() {
  const { frame, closeFrame } = useSimulation();
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

  // Modal focus management: move focus to Close when the dialog opens (so keyboard /
  // screen-reader users land INSIDE the dialog rather than on app controls hidden
  // behind the dim backdrop) and restore it to the prior element on close.
  const open = Boolean(frame);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, [open]);

  if (!frame) return null;

  return (
    <div
      // justify-center + child my-auto (not items-center): when the frame is
      // taller than a phone's viewport minus the dock, a centered flex child
      // clips off the TOP — where the Close button lives — with no way to scroll
      // to it; margin-auto centering inside an overflow-y-auto parent degrades
      // to scrollable instead.
      className="fixed inset-x-0 top-0 bottom-[calc(var(--sim-bar-h)_+_8px)] z-[var(--z-sim-frame)] flex justify-center overflow-y-auto bg-ink/45 p-6"
      // Backdrop dismiss works whether or not the run is paused — the demo continues
      // via the API path, so a viewer who wants out is never trapped behind the dim
      // layer (previously only the tiny X / Escape dismissed while playing).
      onClick={closeFrame}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={frame.title}
        className="my-auto w-full max-w-md overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-overlay"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-stone-200 bg-paper px-3 py-2 text-sm">
          <span className="rounded-full bg-coral/15 px-2 py-0.5 text-meta font-semibold uppercase tracking-wide text-coral">
            {frame.title}
          </span>
          <span className="min-w-0 flex-1 truncate text-steel">{frame.url}</span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeFrame}
            title="Close (Esc)"
            className="focus-ring -mr-1 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-meta font-semibold text-steel hover:bg-stone-100 hover:text-ink"
          >
            <X size={16} aria-hidden />
            <span>Close</span>
          </button>
        </div>
        <div className="relative h-[min(520px,68dvh)] w-full bg-paper">
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
