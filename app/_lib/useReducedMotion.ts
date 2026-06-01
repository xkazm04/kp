"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function readPreference(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

// One shared gate for the OS "reduce motion" preference. JS-driven animations
// (framer-motion sweeps, looping SMIL) call this and snap to their final/static
// state when it returns true — giving motion-sensitive users the same treatment
// the CSS `motion-reduce:` utilities (Meter, ScoreBar) and globals.css keyframe
// overrides already provide. Subscribes to changes so flipping the OS setting
// updates live without a reload.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readPreference);

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
