"use client";

import { useCallback, useSyncExternalStore } from "react";

const EVENT = "kp-persisted-choice";
/** This tab's picks, so a pick still holds for the visit when storage is blocked. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    /* storage blocked (private window, file://): the visit's own pick, if any */
    return memory.get(key) ?? null;
  }
}

/**
 * A per-browser remembered pick (a view, a lens, a ladder presentation): a convenience, never state
 * anyone else reads. Server render and first paint use `fallback`; the stored value snaps in at
 * hydration. Blocked storage keeps a pick for this visit only.
 */
export function usePersistedChoice<T extends string>(key: string, isValid: (v: unknown) => v is T, fallback: T): [T, (next: T) => void] {
  const subscribe = useCallback((notify: () => void) => {
    const on = (e: Event) => {
      if (e instanceof StorageEvent ? e.key === key : (e as CustomEvent<string>).detail === key) notify();
    };
    window.addEventListener("storage", on);
    window.addEventListener(EVENT, on);
    return () => {
      window.removeEventListener("storage", on);
      window.removeEventListener(EVENT, on);
    };
  }, [key]);
  const snapshot = useCallback(() => {
    const v = read(key);
    return isValid(v) ? v : fallback;
  }, [key, isValid, fallback]);
  const value = useSyncExternalStore(subscribe, snapshot, () => fallback);
  const set = useCallback(
    (next: T) => {
      memory.set(key, next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* storage blocked: the pick lives in memory for this visit */
      }
      window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
    },
    [key]
  );
  return [value, set];
}
