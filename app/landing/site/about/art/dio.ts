import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

/*
 * The contract between About's page controller (../AboutLine.tsx) and the eight
 * step drawings in this folder (the prototype's about-art/s1..s8-*.js).
 *
 * Each drawing renders ONE root: `<div className="dio dio-<key>" data-side={side}
 * style={vars}>`, exactly the prototype's html(side) markup, class names kept so
 * the scoped sheets (../../css/about-s*-*.css) style it. The controller owns the
 * rest, as about.js did:
 *   - it toggles `is-in` on that root when the step scrolls in (CSS animations
 *     start from `.dio.is-in`), removes it when the step leaves, and re-adds it
 *     for Replay;
 *   - every time it adds `is-in` it dispatches DIO_ENTER on the root, which is
 *     what a drawing with scripted extras (count-ups) listens for.
 * So a drawing never sets its own root's className from React state (the
 * controller's class would be overwritten): keep the root's className a
 * constant; put state on children or in data attributes.
 */
export type Side = "l" | "r";

/** The step's colours as CSS custom properties: --sc, --sc-hi, --sc-ink. */
export type DioVars = CSSProperties & Record<`--${string}`, string>;

export type DioProps = {
  /** Which side of the page the drawing sits on ("l" for steps 1, 3, 5, 7). */
  side: Side;
  /** --sc / --sc-hi / --sc-ink of the step, set on the root as the prototype did. */
  vars: DioVars;
};

/** The event the controller fires on a drawing's root each time it (re)enters. */
export const DIO_ENTER = "dio-enter";

const REDUCED = "(prefers-reduced-motion: reduce)";

/** Read `prefers-reduced-motion` now (client only: call it from effects and handlers). */
export function reducedMotionNow(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCED).matches;
}

/**
 * Run `onEnter` whenever the controller fires DIO_ENTER on `ref`'s element; the
 * returned cleanup of `onEnter` (optional) runs before the next entry and on
 * unmount, so timers and animation frames never outlive the drawing.
 */
export function useDioEnter(
  ref: RefObject<HTMLElement | null>,
  onEnter: () => void | (() => void)
): void {
  const latest = useRef(onEnter);
  useEffect(() => {
    latest.current = onEnter;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cleanup: void | (() => void);
    const run = () => {
      if (cleanup) cleanup();
      cleanup = latest.current();
    };
    el.addEventListener(DIO_ENTER, run);
    return () => {
      el.removeEventListener(DIO_ENTER, run);
      if (cleanup) cleanup();
    };
  }, [ref]);
}
