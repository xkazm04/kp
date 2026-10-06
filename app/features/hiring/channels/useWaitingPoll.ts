"use client";

import { useEffect, useRef, useState } from "react";
import { startWaitPoll } from "./receiverWaiting";

/**
 * While `active` (some receiver is still Waiting), re-read the receivers on a bounded
 * poll so the card moves to Reached on its own when the first request lands. Returns a
 * `now` that advances with each poll so the elapsed-time line stays fresh without its
 * own timer. Torn down on unmount and the moment `active` turns false.
 */
export function useWaitingPoll(active: boolean, load: () => void): number {
  const [now, setNow] = useState(() => Date.now());
  // The latest values, read at tick time, so the interval is not rebuilt on every render.
  const activeRef = useRef(active);
  const loadRef = useRef(load);
  useEffect(() => {
    activeRef.current = active;
    loadRef.current = load;
  });
  useEffect(() => {
    if (!active) return;
    return startWaitPoll({
      load: () => loadRef.current(),
      isActive: () => activeRef.current,
      isHidden: () => document.hidden,
      onTick: () => setNow(Date.now()),
    });
  }, [active]);
  return now;
}
