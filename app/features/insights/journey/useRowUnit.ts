"use client";

// One global row height that GROWS to the tallest sentence actually on screen.
//
// THE PROBLEM THIS SOLVES. The winner's claim is "column width guarantees no
// clipped sentence", and its own markup does not keep it — the shipped
// prototype sets `overflow:hidden` on the row text and its screenshot clips
// "Candidate described their stack experien…". A fixed row height and a wrapped
// sentence cannot both be right unless somebody measures, and nothing can
// measure a sentence before it exists: this board renders four locales (a German
// compound noun is not an English one) and the app has a larger-text preference
// that rewrites `--text-sm` under the reader.
//
// So: rows start at `JOURNEY_ROW_BASE`, and after every commit the board asks
// the cells that are actually mounted whether any of them overflowed. If one
// did, the unit rises — ONCE, GLOBALLY, for every row on the board, so the rail
// and 99 columns stay aligned — and never falls again in the session, so a
// column mounting late cannot make the grid jump back and re-clip the row the
// reader is on.
//
// Cost: one `querySelectorAll` over the mounted cells per commit, inside a rAF,
// and it stops finding work almost immediately because the unit only grows.

import { useCallback, useEffect, useRef, useState } from "react";
import { JOURNEY_ROW_BASE, requiredRowUnit } from "./journeyLayout";

/** Marks a cell whose content must fit. Read by the probe below. */
export const ROW_MEASURE_ATTR = "data-jr-measure";

export function useRowUnit(rootRef: { current: HTMLElement | null }, deps: unknown): number {
  const [unit, setUnit] = useState(JOURNEY_ROW_BASE);
  const frameRef = useRef(0);

  const probe = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll<HTMLElement>(`[${ROW_MEASURE_ATTR}]`);
    if (nodes.length === 0) return;
    const measured: { scrollHeight: number; clientHeight: number }[] = [];
    for (const node of nodes) measured.push({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight });
    setUnit((current) => requiredRowUnit(current, measured));
  }, [rootRef]);

  useEffect(() => {
    if (typeof requestAnimationFrame === "undefined") return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(probe);
    return () => cancelAnimationFrame(frameRef.current);
    // `deps` is the caller's "something that can change a cell's height changed"
    // signal — the plan identity plus the number of mounted columns.
  }, [probe, deps]);

  return unit;
}
