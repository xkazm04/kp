"use client";

// Lazy column mounting — the technique the winning prototype used to hold ~99
// columns, restated for React.
//
// kp has NO virtualization library and P3 may not add one, so the board borrows
// the Broadsheet's answer: every column reserves its full width and height from
// the plan (so the track's scroll extent and every row's y position are correct
// before anything is drawn), but its ROWS are only committed to the DOM when the
// column comes near the viewport. One IntersectionObserver, rooted on the
// board's own scroller, with a generous horizontal margin so a column is filled
// a screen before it is read rather than while it is read.
//
// Two things make this cheap in React where the prototype could mutate innerHTML:
//
//  1. The set of mounted ids lives in ONE state atom, and a column that is
//     already mounted never leaves it. Scrolling back and forth therefore stops
//     doing work, and a mounted column is never torn down mid-read.
//  2. Observation is registered through a ref CALLBACK keyed by column id, so a
//     column that unmounts (a filter change) unobserves itself without the
//     board having to keep a parallel list.
//
// The board still pays for 99 column HEADERS on the first commit — they carry
// the candidate's name, which the find box and the minimap both read, and they
// are one element each.

import { useCallback, useEffect, useRef, useState } from "react";

/** How early a column is filled, relative to the scroller. Vertical margin is
 *  small (the board scrolls mostly sideways); horizontal is ~one wide screen. */
export const COLUMN_ROOT_MARGIN = "200px 1200px";

export type ColumnMounter = {
  /** True once this column has been near the viewport. Never goes back to false. */
  isMounted: (id: string) => boolean;
  /** `ref` for the column element. */
  observe: (id: string) => (node: HTMLElement | null) => void;
  /** Force a column in (the find box jumps to a column that may be far off-screen). */
  mountNow: (id: string) => void;
  /** How many columns are in the DOM right now — read by the layout tests. */
  mountedCount: number;
};

export function useVisibleColumns(): ColumnMounter {
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const idsRef = useRef(new WeakMap<Element, string>());

  useEffect(() => {
    // No IntersectionObserver (jsdom, a very old browser): fail OPEN. A column
    // that never mounts is a far worse bug than every column mounting at once —
    // the same rule `Defer` states for its `visible` strategy.
    if (typeof IntersectionObserver === "undefined") {
      const all = new Set(nodesRef.current.keys());
      if (all.size > 0) setMounted((prev) => new Set([...prev, ...all]));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const arrived: string[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = idsRef.current.get(entry.target);
          if (id !== undefined) {
            arrived.push(id);
            observer.unobserve(entry.target);
          }
        }
        if (arrived.length > 0) setMounted((prev) => new Set([...prev, ...arrived]));
      },
      { rootMargin: COLUMN_ROOT_MARGIN }
    );
    observerRef.current = observer;
    for (const node of nodesRef.current.values()) observer.observe(node);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  // One STABLE ref callback per column id. A fresh closure per render would make
  // React detach and re-attach every one of 99 refs on every render, which is
  // 198 observer calls per keystroke in the find box — the exact cost this hook
  // exists to avoid.
  const callbacksRef = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const observe = useCallback((id: string) => {
    const cached = callbacksRef.current.get(id);
    if (cached) return cached;
    const fn = (node: HTMLElement | null) => {
      const previous = nodesRef.current.get(id);
      if (previous && previous !== node) {
        observerRef.current?.unobserve(previous);
        nodesRef.current.delete(id);
      }
      if (!node) return;
      nodesRef.current.set(id, node);
      idsRef.current.set(node, id);
      observerRef.current?.observe(node);
    };
    callbacksRef.current.set(id, fn);
    return fn;
  }, []);

  const isMounted = useCallback((id: string) => mounted.has(id), [mounted]);
  const mountNow = useCallback((id: string) => {
    setMounted((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
  }, []);

  return { isMounted, observe, mountNow, mountedCount: mounted.size };
}
