"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { FULL_CLIP, PULL, flipTransform, lineClip, rowBand, swapFrames, type Rect } from "./loomPull";
import type { LoomTransition } from "./useLoomNav";

const rel = (r: DOMRect, o: DOMRect): Rect => ({ left: r.left - o.left, top: r.top - o.top, width: r.width, height: r.height });

/** The loom row an opener sits on: its knot cells (for the band) and the dimension it names. */
function rowOf(opener: HTMLElement | null) {
  if (!opener?.isConnected || opener.getClientRects().length === 0) return null;
  const row = opener.closest<HTMLElement>('[role="row"]');
  const cells = row ? [...row.querySelectorAll<HTMLElement>(".lm-cross-cell")] : [];
  if (!row || cells.length === 0) return null;
  return { row, cells, dimension: opener.dataset.loomRow ?? null, box: opener.getBoundingClientRect() };
}

/**
 * Runs the Loom's descent on the DOM the level stack just committed (loomPull.ts describes it):
 * the ghost row's flight, the page unravelling out of it (or winding back into it), the sideways
 * slide, and a cross-fade under reduced motion. Every animation is cancelled when the transition
 * ends (a finished `fill` clip would keep clipping a page that grows), and a settle timer ends the
 * transition even if an animation never reports.
 */
export function useLoomPull(rootRef: RefObject<HTMLElement | null>, transition: LoomTransition, reduced: boolean, settle: () => void): void {
  const done = useRef(settle);
  useLayoutEffect(() => {
    done.current = settle;
  });
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!transition || !root) return;
    const anims: Animation[] = [];
    const undo: Array<() => void> = [];
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      done.current();
    };
    const timer = window.setTimeout(finish, PULL.maxMs);
    const run = (el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions, last = false) => {
      if (!el || typeof (el as HTMLElement).animate !== "function") return;
      const a = (el as HTMLElement).animate(frames, { fill: "both", ...opts });
      if (last) a.onfinish = finish;
      anims.push(a);
    };
    const mode = transition.kind === "open" ? "entering" : transition.kind === "close" ? "leaving" : "swapping";
    const layer = root.querySelector<HTMLElement>(`.k-layer[data-mode="${mode}"]`);
    if (!layer) {
      finish();
    } else if (transition.kind === "swap") {
      run(layer, swapFrames(transition.dir, reduced), { duration: reduced ? PULL.fadeOnlyMs : PULL.swapMs, easing: PULL.ease }, true);
    } else {
      const opening = transition.kind === "open";
      const from = rowOf(transition.opener);
      const rail = layer.querySelector<HTMLElement>("[data-loom-rail]");
      const ghost = root.querySelector<HTMLElement>("[data-loom-ghost]");
      if (reduced || !from || !rail || !ghost) {
        run(layer, opening ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { duration: PULL.fadeOnlyMs }, true);
      } else {
        const rootBox = root.getBoundingClientRect();
        const layerBox = layer.getBoundingClientRect();
        const railBox = rel(rail.getBoundingClientRect(), rootBox);
        const first = rel(from.cells[0].getBoundingClientRect(), rootBox);
        const last = rel(from.cells[from.cells.length - 1].getBoundingClientRect(), rootBox);
        const band = rowBand(first, last, from.cells.length, from.box.top - rootBox.top + from.box.height / 2, railBox.height);
        Object.assign(ghost.style, { left: `${railBox.left}px`, top: `${railBox.top}px`, width: `${railBox.width}px`, height: `${railBox.height}px` });
        const lifted = [from.row, from.dimension ? root.querySelector(`.lm-row[data-dim="${from.dimension}"]`) : null].filter((x): x is HTMLElement => x instanceof Element);
        lifted.forEach((el) => el.setAttribute("data-lifted", ""));
        undo.push(() => lifted.forEach((el) => el.removeAttribute("data-lifted")));
        const line = lineClip(railBox.top + rootBox.top - layerBox.top + railBox.height / 2, layerBox.height);
        const flip = flipTransform(band, railBox);
        if (opening) {
          run(ghost, [{ transform: flip }, { transform: "none" }], { duration: PULL.liftMs, easing: PULL.ease });
          run(layer, [{ clipPath: line }, { clipPath: FULL_CLIP }], { duration: PULL.openMs, delay: PULL.openDelay, easing: PULL.ease });
          run(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: PULL.fadeMs, delay: PULL.openDelay + PULL.openMs - 80 }, true);
        } else {
          run(layer, [{ clipPath: FULL_CLIP }, { clipPath: line }], { duration: PULL.closeMs, easing: PULL.easeIn });
          run(ghost, [{ opacity: 0 }, { opacity: 1 }], { duration: 80, delay: PULL.closeMs - 100 });
          run(ghost, [{ transform: "none" }, { transform: flip }], { duration: PULL.returnMs, delay: PULL.closeMs - 40, easing: PULL.ease }, true);
        }
      }
    }
    return () => {
      window.clearTimeout(timer);
      anims.forEach((a) => a.cancel());
      undo.forEach((f) => f());
    };
  }, [transition, reduced, rootRef]);
}
