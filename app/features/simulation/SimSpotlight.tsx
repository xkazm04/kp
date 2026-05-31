"use client";

import { useEffect, useState } from "react";
import { useSimulation } from "./SimulationProvider";

type Rect = { top: number; left: number; width: number; height: number };

// A coachmark overlay: dims the page, rings the element the driver is acting on,
// and shows a readable "what's happening" caption. Targets a [data-sim] anchor;
// falls back to the main content region so it never points at nothing.
export function SimSpotlight() {
  const { running, spotlight } = useSimulation();
  const [rect, setRect] = useState<Rect | null>(null);

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
        setRect({
          top: Math.max(8, r.top - pad),
          left: Math.max(8, r.left - pad),
          width: Math.min(window.innerWidth - 16, r.width + pad * 2),
          height: r.height + pad * 2,
        });
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

  return (
    <div className="pointer-events-none fixed inset-0 z-[45]">
      {/* Ring around the active feature. */}
      <div
        className="absolute rounded-xl ring-2 ring-coral transition-all duration-500 ease-out"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 0 0 9999px rgba(28,25,23,0.28)",
        }}
      >
        <span className="absolute inset-0 animate-ping rounded-xl ring-2 ring-coral/40" />
      </div>

      {/* Caption bubble. */}
      <div
        className="absolute max-w-md rounded-lg border border-stone-200 bg-white px-3.5 py-2.5 shadow-xl"
        style={{ top: captionTop, left: Math.min(rect.left, window.innerWidth - 420) }}
      >
        <p className="text-meta font-semibold uppercase tracking-wide text-coral">{spotlight.title}</p>
        <p className="mt-0.5 text-sm leading-snug text-ink">{spotlight.caption}</p>
      </div>
    </div>
  );
}
