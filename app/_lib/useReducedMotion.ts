"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

// One shared gate for the OS "reduce motion" preference. JS-driven animations
// (framer-motion sweeps, looping SMIL) call this and snap to their final/static
// state when it returns true — giving motion-sensitive users the same treatment
// the CSS `motion-reduce:` utilities (Meter, ScoreBar) and globals.css keyframe
// overrides already provide. Subscribes to changes so flipping the OS setting
// updates live without a reload.
//
// Initialized to `false` to MATCH the server render: reading window.matchMedia
// during the first (hydration) render would return the real preference on the
// client while the server rendered `false`, so any consumer that branches its DOM
// on this flag would hydrate mismatched markup and flash. We seed `false` (SSR
// parity) and set the true value in the effect below, so the hook is structurally
// hydration-safe no matter how a consumer uses it.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
