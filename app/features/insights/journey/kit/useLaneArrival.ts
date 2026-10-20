"use client";

import { useLayoutEffect, useState } from "react";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { claimPlay, hasPlayed, prefersReducedMotionNow } from "@/app/_components/kit/graphic/playOnce";

const ID = "journey-lanes";
/** Replay keys whose sweep window is still open. Module state, as playOnce's own memory is. */
const open = new Set<string>();

/**
 * The lane sweep's switch (Lane `arriving`): true from the first paint of a new replay key (a role
 * picked, the data changed) for about a second, then false for good. A windowed table mounts rows
 * as they scroll in; rows arriving after the window has closed never sweep, so scrolling never
 * animates. The claim lives in playOnce, so a StrictMode rehearsal or a remount does not sweep
 * twice; under reduced motion it never opens and the lanes draw their final frame.
 */
export function useLaneArrival(replayKey: string, ready: boolean, holdMs = 1000): boolean {
  const reduced = useReducedMotion();
  const [, bump] = useState(0);
  // Before the claim, the first render(s) of a fresh key already draw the arrival, so the first
  // paint is the start of the sweep rather than a finished frame that then jumps.
  const fresh = ready && !reduced && !hasPlayed(ID, replayKey) && !prefersReducedMotionNow();
  useLayoutEffect(() => {
    if (!ready) return;
    if (!claimPlay(ID, replayKey, reduced || prefersReducedMotionNow())) return;
    open.add(replayKey);
    // Not cleared on cleanup, as usePlayOnce: a StrictMode re-run cannot claim again.
    window.setTimeout(() => {
      open.delete(replayKey);
      bump((n) => n + 1);
    }, holdMs);
    // `reduced` is read at claim time only: flipping it later must not replay stale data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey, ready, holdMs]);
  return fresh || open.has(replayKey);
}
