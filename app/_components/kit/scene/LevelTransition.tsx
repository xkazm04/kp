"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { LayerMode } from "./levelStack";
import { WIPE_CLOSE, WIPE_FADE_MS, WIPE_OPEN, wipeFrames, wipeOrigin } from "./wipe";
import "./scene.css";

/**
 * @catalog One level of a level stack and its transition: opens as a circle growing from the element that was touched, closes as the same circle shrinking back onto it, a sideways step fades; reduced motion cross-fades.
 *
 * The mode comes from `layerModeAt` (levelStack.ts, where each mode is described). The wipe runs on
 * the layer's own box (`clip-path: circle()` via the Web Animations API), measured from `opener` at
 * the moment it starts, so a close lands on the element that is visible again by then. `onSettled`
 * fires once the transition ends (or at once when there is none). The DOM contract a surface's
 * focus and keys read: `.k-layer[data-depth][data-mode]`; a covered layer is `hidden` (kept
 * mounted), the one under an opening level and a closing one are `inert`. Each layer is its own
 * stacking context.
 */
export function LevelTransition({ mode, opener, onSettled, depth, children }: {
  mode: LayerMode;
  opener: HTMLElement | null;
  onSettled?: () => void;
  /** The layer's place in the stack (0 = the root); focus and tests find a layer by it. */
  depth: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const settle = useRef(onSettled);
  useLayoutEffect(() => {
    settle.current = onSettled;
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || (mode !== "entering" && mode !== "leaving" && mode !== "swapping")) return;
    let anim: Animation | null = null;
    if (reduced || mode === "swapping" || typeof el.animate !== "function") {
      const show = mode !== "leaving";
      anim = el.animate?.([{ opacity: show ? 0 : 1 }, { opacity: show ? 1 : 0 }], { duration: WIPE_FADE_MS, fill: "forwards" }) ?? null;
    } else {
      const box = el.getBoundingClientRect();
      const visible = opener && opener.isConnected && opener.getClientRects().length > 0 ? opener.getBoundingClientRect() : null;
      const pt = wipeOrigin(box, visible);
      const spec = mode === "entering" ? WIPE_OPEN : WIPE_CLOSE;
      const frames = wipeFrames(pt, { width: box.width, height: box.height }, mode === "entering" ? "open" : "close");
      anim = el.animate(frames.map((clipPath) => ({ clipPath })), { duration: spec.ms, easing: spec.easing, fill: "forwards" });
    }
    if (!anim) {
      settle.current?.();
      return;
    }
    anim.onfinish = () => settle.current?.();
    // Always cancel: a finished `fill: forwards` clip would keep clipping a level that grows
    // taller after it opened (its data arriving).
    return () => anim?.cancel();
  }, [mode, reduced, opener]);

  return (
    <div
      ref={ref}
      className="k-layer"
      data-mode={mode}
      data-depth={depth}
      hidden={mode === "hidden" || undefined}
      inert={mode === "under" || mode === "leaving" || undefined}
    >
      {children}
    </div>
  );
}
