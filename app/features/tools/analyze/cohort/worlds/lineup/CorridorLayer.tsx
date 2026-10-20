"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { LayerMode } from "@/app/_components/kit/scene";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { CORRIDOR_CLOSE, CORRIDOR_FADE_MS, CORRIDOR_OPEN, SETTLE_MARGIN_MS, STAIRS, corridorFrames, stairFrames, type Rect } from "./corridor";

/** The band's box on screen, found from the layer's own world; null when it is not drawn (or has no width). */
function measureBand(layer: HTMLElement, selector: string | null | undefined): Rect | null {
  const r = selector ? layer.closest(".lu-world")?.querySelector(selector)?.getBoundingClientRect() : undefined;
  return r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

/**
 * One level of the Line-up and its own transition (the kit's LevelTransition draws a circle; this world
 * walks into a FLOOR): it opens as the pressed floor's band across the street, growing until it is the
 * page (`clip-path: inset()`, corridor.ts), closes back into that band, and a stair step slides the next
 * floor in from the side it lies on. Reduced motion cross-fades. Same DOM contract as the kit's layer,
 * `.k-layer[data-depth][data-mode]`, so its CSS (absolute while it opens or closes) applies; a covered
 * level stays mounted (`hidden`), the one under an opening floor and a closing one are `inert`. A lost
 * `finish` (a hidden tab) cannot strand the street: a timer settles the level anyway.
 */
export function CorridorLayer({ mode, depth, band, dir = 1, onSettled, children }: {
  mode: LayerMode;
  depth: number;
  /** A selector, inside the world, for the band the corridor opens from / closes into (measured as it starts). */
  band?: string | null;
  /** The stairs' direction for a sideways step: 1 = down a floor, -1 = up. */
  dir?: 1 | -1;
  onSettled?: () => void;
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
    if (typeof el.animate !== "function") {
      settle.current?.();
      return;
    }
    let anim: Animation;
    let ms: number;
    if (reduced) {
      const show = mode !== "leaving";
      ms = CORRIDOR_FADE_MS;
      anim = el.animate([{ opacity: show ? 0 : 1 }, { opacity: show ? 1 : 0 }], { duration: ms, fill: "forwards" });
    } else if (mode === "swapping") {
      ms = STAIRS.ms;
      anim = el.animate(stairFrames(dir), { duration: ms, easing: STAIRS.easing });
    } else {
      const open = mode === "entering";
      const spec = open ? CORRIDOR_OPEN : CORRIDOR_CLOSE;
      const frames = corridorFrames(el.getBoundingClientRect(), measureBand(el, band), open ? "open" : "close");
      ms = spec.ms;
      anim = el.animate(frames, { duration: ms, easing: spec.easing, fill: "forwards" });
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      settle.current?.();
    };
    anim.onfinish = finish;
    const timer = window.setTimeout(finish, ms + SETTLE_MARGIN_MS);
    // Always cancel: a finished `fill: forwards` clip would keep clipping a floor that grows taller.
    return () => {
      window.clearTimeout(timer);
      anim.cancel();
    };
  }, [mode, reduced, dir, band]);

  return (
    <div
      ref={ref}
      className="k-layer lu-layer"
      data-mode={mode}
      data-depth={depth}
      hidden={mode === "hidden" || undefined}
      inert={mode === "under" || mode === "leaving" || undefined}
    >
      {children}
    </div>
  );
}
