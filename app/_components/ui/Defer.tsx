"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import {
  DEFER_IDLE_TIMEOUT_MS,
  DEFER_VISIBLE_ROOT_MARGIN,
  mountsImmediately,
  type DeferStrategy,
} from "./defer-policy";

/*
 * <Defer> — keep a subtree out of the FIRST DOM commit and let it arrive a beat
 * later (docs/LOADING_CHOREOGRAPHY.md, tier 3).
 *
 * This is the "no big bang" primitive. A tab's chrome and primary content commit
 * on the first frame; everything secondary — charts, long tables, collapsed
 * panels, below-the-fold sections — is wrapped here so the browser gets to paint
 * before it has to build them. The staged arrival is also what makes the tab feel
 * fast: something is on screen immediately, and the rest lands while you read it.
 *
 * It is NOT a loading state. There is no spinner, no skeleton, and no data
 * involved — `children` are ready to render, we are only choosing WHEN to commit
 * them. Pair it with `placeholder` only when the gap would shift layout; the
 * placeholder should reserve space quietly (see `.reveal-quiet` in globals.css),
 * never imitate the content.
 *
 * Under `prefers-reduced-motion` the timed strategies collapse to a plain mount:
 * arriving in waves IS motion. `visible` still defers — that one is about not
 * building what nobody looked at.
 */
export function Defer({
  children,
  strategy = "idle",
  placeholder = null,
  rootMargin = DEFER_VISIBLE_ROOT_MARGIN,
  immediate = false,
}: {
  children: ReactNode;
  /** When to commit. Default `idle`; use `next-frame` for the first fold below
   *  the primary content, `visible` for heavy widgets far down the page. */
  strategy?: DeferStrategy;
  /** Rendered until the subtree commits. Default nothing. Use a sized, empty
   *  element when the gap would otherwise collapse the layout. */
  placeholder?: ReactNode;
  /** `visible` only — how early to arm, relative to the viewport. */
  rootMargin?: string;
  /** Escape hatch (tests, print, forced eager render). */
  immediate?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // The policy is re-evaluated per render: a user flipping the OS setting, or a
  // reducedMotion value that corrects itself after hydration, resolves here.
  const now = mountsImmediately({ strategy, reducedMotion, immediate });

  useEffect(() => {
    if (now || ready) return;

    if (strategy === "next-frame") {
      const id = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(id);
    }

    if (strategy === "visible") {
      const node = sentinelRef.current;
      // No node (or no IntersectionObserver — jsdom, very old browsers): fail
      // OPEN. Content that never mounts is a far worse bug than content that
      // mounts early.
      if (!node || typeof IntersectionObserver === "undefined") {
        setReady(true);
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setReady(true);
            observer.disconnect();
          }
        },
        { rootMargin }
      );
      observer.observe(node);
      return () => observer.disconnect();
    }

    // strategy === "idle"
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(() => setReady(true), { timeout: DEFER_IDLE_TIMEOUT_MS });
      return () => window.cancelIdleCallback?.(handle);
    }
    // Safari / jsdom: the next macrotask is the closest always-fires equivalent.
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, [now, ready, strategy, rootMargin]);

  if (now || ready) return <>{children}</>;
  // `visible` needs something in the DOM to observe; the other strategies must
  // not add a wrapper element (it would break grid/flex parents).
  if (strategy === "visible") {
    return (
      <div ref={sentinelRef} aria-hidden>
        {placeholder}
      </div>
    );
  }
  return <>{placeholder}</>;
}
