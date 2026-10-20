"use client";

// Below COHORT_NARROW_PX the studio shows the card list instead of a world. JS, not CSS, on
// purpose: only one of the two is MOUNTED (a 20-member world and its key handlers are not
// rendered just to be hidden). Server render and first paint assume wide; the query snaps in.
import { useSyncExternalStore } from "react";
import { COHORT_NARROW_PX } from "./cohortShell";

const QUERY = `(max-width: ${COHORT_NARROW_PX - 0.02}px)`;

function subscribe(notify: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", notify);
  return () => mq.removeEventListener("change", notify);
}

export function useNarrowStudio(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
