"use client";

import { useLayoutEffect, type RefObject } from "react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { claimPlay, prefersReducedMotionNow } from "./playOnce";

/**
 * A part's CSS entrance, played once per (`id`, `replayKey`): the first time the part has drawn its
 * nodes for a key, `is-arriving` goes on (the root, or every node matching `each`, with a staggered
 * `animation-delay`) before the first paint, and comes off after `holdMs` so a later re-render (a
 * brush, a selection) never restarts an animation on re-created nodes. Never under reduced motion.
 * The claim lives in playOnce.ts, so a StrictMode rehearsal or a remount cannot spend it twice.
 */
export function usePlayOnce(
  id: string,
  replayKey: string,
  root: RefObject<Element | null>,
  opts: { ready?: boolean; each?: string; delay?: (index: number, count: number) => number; holdMs?: number } = {}
): void {
  const reduced = useReducedMotion();
  const { ready = true, each, delay, holdMs = 1200 } = opts;
  useLayoutEffect(() => {
    const el = root.current;
    if (!ready || !el) return;
    if (!claimPlay(id, replayKey, reduced || prefersReducedMotionNow())) return;
    const nodes: Element[] = each ? Array.from(el.querySelectorAll(each)) : [el];
    nodes.forEach((n, i) => {
      n.classList.add("is-arriving");
      if (delay && (n instanceof SVGElement || n instanceof HTMLElement)) n.style.animationDelay = `${delay(i, nodes.length)}ms`;
    });
    // Not cleared on cleanup: a StrictMode re-run cannot claim again, so a cancelled timer would
    // leave the class on for good. Removing it from detached nodes is harmless.
    window.setTimeout(() => nodes.forEach((n) => n.classList.remove("is-arriving")), holdMs);
    // `reduced` is read at claim time only: flipping it later must not replay stale data. `delay` and
    // `each` are per-part constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, replayKey, ready]);
}
