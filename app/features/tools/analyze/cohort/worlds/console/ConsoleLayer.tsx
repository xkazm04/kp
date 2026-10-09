"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { LayerMode } from "@/app/_components/kit/scene";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { SOLO_CLOSE, SOLO_FADE_MS, SOLO_OPEN, SOLO_SWAP_MS, busBand, soloFrames } from "./consoleNav";

const visible = (el: HTMLElement | null): el is HTMLElement => el !== null && el.isConnected && el.getClientRects().length > 0;

/**
 * One level of the desk and its SOLO transition (the world's own, not the kit's circle): a soloed
 * bus opens as the pressed bus's band widening to the whole layer (`clip-path: inset()`, after the
 * desk's other buses have muted), and closes as the same band narrowing back onto the bus it came
 * from, measured when the close starts. A sideways step slides the new bus in from the side it
 * came from; reduced motion cross-fades only. Every animation is cancelled when it ends (a kept
 * clip would cut a level that grows) and has a settle timer, so a level never waits on a frame
 * that is not painted. DOM contract: `.cx-layer[data-depth][data-mode]` (the same modes as the
 * kit's layerModeAt); a covered layer is `hidden` (kept mounted), an under / leaving one `inert`.
 */
export function ConsoleLayer({ mode, opener, dir = 1, onSettled, depth, children }: {
  mode: LayerMode;
  opener: HTMLElement | null;
  dir?: 1 | -1;
  onSettled?: () => void;
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
    const done = () => settle.current?.();
    if (typeof el.animate !== "function") {
      done();
      return;
    }
    let anim: Animation;
    let ms: number;
    if (reduced) {
      const show = mode !== "leaving";
      ms = SOLO_FADE_MS;
      anim = el.animate([{ opacity: show ? 0 : 1 }, { opacity: show ? 1 : 0 }], { duration: ms, fill: "forwards" });
    } else if (mode === "swapping") {
      ms = SOLO_SWAP_MS;
      anim = el.animate([{ opacity: 0, transform: `translateX(${dir * 28}px)` }, { opacity: 1, transform: "none" }], { duration: ms, easing: "cubic-bezier(.2,.8,.2,1)" });
    } else {
      const box = el.getBoundingClientRect();
      const band = busBand(box, visible(opener) ? opener.getBoundingClientRect() : null);
      const open = mode === "entering";
      const spec = open ? SOLO_OPEN : SOLO_CLOSE;
      ms = spec.ms + (open ? SOLO_OPEN.delay : 0);
      anim = el.animate(soloFrames(band, open ? "open" : "close").map((clipPath) => ({ clipPath })), {
        duration: spec.ms, delay: open ? SOLO_OPEN.delay : 0, easing: spec.easing, fill: "both",
      });
    }
    anim.onfinish = done;
    // The settle timer: a hidden tab never paints the frames, and a level must not wait on them.
    const timer = window.setTimeout(done, ms + 160);
    return () => {
      window.clearTimeout(timer);
      anim.cancel();
    };
  }, [mode, reduced, opener, dir]);

  return (
    <div
      ref={ref}
      className="cx-layer"
      data-mode={mode}
      data-depth={depth}
      hidden={mode === "hidden" || undefined}
      inert={mode === "under" || mode === "leaving" || undefined}
    >
      {children}
    </div>
  );
}
