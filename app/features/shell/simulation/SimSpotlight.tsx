"use client";

import { useEffect, useRef, useState } from "react";
import { useSimulation } from "./SimulationProvider";

type Rect = { top: number; left: number; width: number; height: number };

const sameRect = (a: Rect, b: Rect) =>
  a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

// A coachmark overlay: dims the page, rings the element the driver is acting on,
// and shows a readable "what's happening" caption. Targets a [data-sim] anchor;
// falls back to the main content region so it never points at nothing.
export function SimSpotlight() {
  const { running, spotlight } = useSimulation();
  const [rect, setRect] = useState<Rect | null>(null);
  // Mirrors the committed `rect` so the rAF loop can detect a real change
  // without reading state (which it can't see between renders anyway).
  const lastRect = useRef<Rect | null>(null);

  useEffect(() => {
    // When inactive we simply stop measuring; the render guard below returns null,
    // so a stale rect is never shown (and we avoid a setState-in-effect).
    if (!running || !spotlight) return;
    let raf = 0;
    const measure = () => {
      const el =
        (spotlight.selector ? document.querySelector(spotlight.selector) : null) ??
        document.querySelector("#main");
      if (el) {
        const r = el.getBoundingClientRect();
        // Clamp/pad so the ring sits nicely around the target.
        const pad = 6;
        const next: Rect = {
          top: Math.max(8, r.top - pad),
          left: Math.max(8, r.left - pad),
          width: Math.min(window.innerWidth - 16, r.width + pad * 2),
          height: r.height + pad * 2,
        };
        // The loop keeps tracking a target that may scroll or animate, but on most
        // frames the target is stationary. Only commit to state when the measurement
        // actually moved, so idle frames trigger no re-render of the overlay.
        if (!lastRect.current || !sameRect(lastRect.current, next)) {
          lastRect.current = next;
          setRect(next);
        }
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [running, spotlight]);

  if (!running || !spotlight || !rect) return null;

  // Caption goes below the target if there's room, else above.
  const below = rect.top + rect.height + 120 < window.innerHeight;
  const captionTop = below ? rect.top + rect.height + 10 : Math.max(8, rect.top - 96);
  // Clamp both edges: the lower bound (8) keeps a left-edge target from shoving
  // the bubble off-screen; the upper bound keeps a right-edge target from running
  // it past the viewport.
  const captionLeft = Math.max(8, Math.min(rect.left, window.innerWidth - 420));
  // Aim the pointer tail at the ring's horizontal centre, kept inside the bubble.
  const ringCenterX = rect.left + rect.width / 2;
  const pointerLeft = Math.max(16, Math.min(ringCenterX - captionLeft, 360));

  return (
    <div className="pointer-events-none fixed inset-0 z-[var(--z-sim-spotlight)]">
      {/* Ring around the active feature. */}
      <div
        className="absolute rounded-xl ring-2 ring-coral transition-all duration-500 ease-out motion-reduce:transition-none"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 0 0 9999px var(--color-scrim)",
        }}
      >
        <span className="absolute inset-0 animate-ping rounded-xl ring-2 ring-coral/40 motion-reduce:animate-none" />
      </div>

      {/* Caption bubble, tied to the ring by a small pointer tail so it reads as
          "this explains that" rather than a detached note. */}
      <div
        className="animate-fade-in motion-reduce:animate-none absolute max-w-md rounded-lg border border-stone-200 bg-white px-3.5 py-2.5 shadow-xl"
        style={{ top: captionTop, left: captionLeft }}
      >
        {/* Triangular pointer: a rotated square sharing the bubble's fill + border,
            aimed up at the ring when the bubble sits below it, else down. */}
        <span
          className="absolute h-3 w-3 rotate-45 border-stone-200 bg-white"
          style={
            below
              ? { top: -6, left: pointerLeft, borderTopWidth: 1, borderLeftWidth: 1 }
              : { bottom: -6, left: pointerLeft, borderBottomWidth: 1, borderRightWidth: 1 }
          }
        />
        <p className="text-meta font-semibold uppercase tracking-wide text-coral">{spotlight.title}</p>
        <p className="mt-0.5 text-sm leading-snug text-ink">{spotlight.caption}</p>
      </div>
    </div>
  );
}
