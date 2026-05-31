"use client";

import { useEffect, useRef } from "react";

// Tiny client-side event bus so open views update live when data changes
// elsewhere — e.g., the simulation driver mutating the pipeline. Mutators call
// notifyDataChanged(); views subscribe with useLiveRefresh(reload).

const EVENT = "kp:data-changed";

/** Signal that server-side data may have changed (call after a mutating fetch). */
export function notifyDataChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/**
 * Re-run `handler` whenever data changes elsewhere. Always calls the latest
 * handler (no re-subscribe churn) and debounces bursts into a single reload.
 */
export function useLiveRefresh(handler: () => void, debounceMs = 250): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler; // keep the latest handler without re-subscribing
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ref.current(), debounceMs);
    };
    window.addEventListener(EVENT, onChange);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(EVENT, onChange);
    };
  }, [debounceMs]);
}
