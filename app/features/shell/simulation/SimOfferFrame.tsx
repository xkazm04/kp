"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { useSimulation } from "./SimulationProvider";

// Shows a candidate-facing page (offer or self-schedule) in a framed panel so the
// viewer watches the real candidate flow. Same-origin, so the driver can reach
// into the frame's document to dispatch a real click when needed.
//
// Responsive: the frame caps at 520px but shrinks on short viewports so it never
// clips under the sim bar. A shimmer skeleton stands in until the iframe's load
// event fires, so a slow candidate page never reads as a blank box. It is a real
// modal (role="dialog"/aria-modal) and is always dismissable — Escape, the visible
// Close button, or a backdrop click — so a viewer is never trapped behind the dim
// layer; closing just continues the demo via the API path.
//
// The dialog contract itself is the SHARED one (useDialogA11y — the same hook and
// the same stack Modal, CandidateDrawer and the explorer drawer use). This file
// used to hand-roll two thirds of it: a window-level Escape listener with no
// stack-gating (so Escape closed this frame AND whatever modal sat above it) and a
// focus-in/restore effect, with no Tab trap at all — the viewer could tab out of an
// aria-modal dialog onto the controls behind the dim backdrop.
export function SimOfferFrame() {
  const { frame, closeFrame } = useSimulation();
  // Mounted only while a frame is open, and remounted per URL, so the hook's
  // mount-time focus/stack registration matches the dialog's real lifecycle
  // (calling it on a component that renders null would push a phantom entry onto
  // the shared stack and swallow Escape for the surface underneath).
  if (!frame) return null;
  return <FrameDialog key={frame.url} url={frame.url} title={frame.title} onClose={closeFrame} />;
}

function FrameDialog({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const t = useTranslations("simulation");
  const [loaded, setLoaded] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Modal: trap Tab and lock page scroll behind the dim layer (the defaults), plus
  // stack-gated Escape and focus restore to whatever the presenter last touched.
  useDialogA11y(dialogRef, onClose);

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
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="my-auto w-full max-w-md overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-overlay focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-stone-200 bg-paper px-3 py-2 text-sm">
          <span className="rounded-full bg-coral/15 px-2 py-0.5 text-meta font-semibold uppercase tracking-wide text-coral">
            {title}
          </span>
          <span className="min-w-0 flex-1 truncate text-steel">{url}</span>
          <button
            type="button"
            onClick={onClose}
            title={t("frame.closeTitle")}
            className="focus-ring -mr-1 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-meta font-semibold text-steel hover:bg-stone-100 hover:text-ink"
          >
            <X size={16} aria-hidden />
            <span>{t("frame.close")}</span>
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
            src={url}
            title={t("frame.candidatePage")}
            onLoad={() => setLoaded(true)}
            className={`h-full w-full bg-paper transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          />
        </div>
      </div>
    </div>
  );
}
