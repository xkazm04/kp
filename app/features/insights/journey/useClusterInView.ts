"use client";

// Which role cluster the ONE rail is currently describing.
//
// The board draws a single rail pinned at the far left (JourneyBoardView), and a
// rail is per role — "rungs are per role: equal y in two clusters is NOT the
// same rung", which is the whole reason it exists. So it has to follow the
// reader: whichever cluster their view is over is the cluster whose steps the
// rail draws and whose title it prints (`journey.rail.forRole`).
//
// READ FROM THE SCROLLER, NOT FROM AN OBSERVER. An IntersectionObserver answers
// "is this section visible", and at 1600px wide two clusters usually are; the
// question here is "which one is the rail sitting on top of", which is one
// number — `scrollLeft + railWidth` — measured against the sections' own
// `offsetLeft`. The sections already carry `data-jr-cluster` (jumpToRole reads
// it) and the rail carries `data-jr-rail`, so nothing new has to be threaded
// through the tree to ask. The arithmetic itself is `clusterIndexInView` in
// journeyLayout.ts, where `node --test` can reach it.
//
// rAF-throttled, exactly like the minimap's own scroll sync: one layout read per
// frame at most, and a sideways drag across 45 columns is a handful of state
// changes rather than one per scroll event.

import { useEffect, useState } from "react";
import { clusterIndexInView } from "./journeyLayout";

export function useClusterInView(
  scrollerRef: { current: HTMLElement | null },
  trackRef: { current: HTMLElement | null },
  clusterCount: number,
  /** Something that changes when the track's geometry does — the plan identity.
   *  A filter that drops a cluster moves every offset after it. */
  deps: unknown
): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (!scroller || !track || clusterCount === 0) {
      setIndex(0);
      return;
    }
    let frame = 0;
    const read = () => {
      const starts: number[] = [];
      for (const section of track.querySelectorAll<HTMLElement>("[data-jr-cluster]")) {
        starts.push(section.offsetLeft);
      }
      const railPx = track.querySelector<HTMLElement>("[data-jr-rail]")?.offsetWidth ?? 0;
      const next = clusterIndexInView(scroller.scrollLeft, railPx, starts);
      setIndex(next < 0 ? 0 : Math.min(next, clusterCount - 1));
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        read();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    read();
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scrollerRef, trackRef, clusterCount, deps]);

  // Clamped on the way out as well as on the way in: the effect runs after the
  // commit that shortened the board, so one render can ask for a cluster that
  // the current filters have already removed.
  return Math.min(index, Math.max(0, clusterCount - 1));
}
