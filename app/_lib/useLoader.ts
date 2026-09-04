"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { asRecord, isLoadFailure, type LoadState } from "./load-state";

// `LoadState` (and the failure/staleness contract) lives in the React-free
// `load-state` module so it can be unit-tested; re-exported here so existing
// consumers can keep importing it from the hook.
export type { LoadState };

// Reloadable / pollable sibling of `useJsonFetch`. Unlike the one-shot hook this
// keeps the last good `data` visible when a refresh fails and tracks whether the
// latest attempt failed plus when the data was last fresh — letting callers tell
// a genuinely empty result apart from a stale one sitting behind an outage.
// Same robust error semantics: a non-OK status, an `{ error }` body, or a
// non-JSON response all count as failures rather than silently rendering empty.
// `select` maps the parsed payload to the rendered value and is read through a
// ref so an inline selector doesn't churn the returned `reload` identity.
export function useLoader<T>(
  url: string,
  select: (payload: Record<string, unknown>) => T,
  initial: T,
): { data: T; state: LoadState; reload: () => Promise<void> } {
  const [data, setData] = useState<T>(initial);
  const [state, setState] = useState<LoadState>({ failed: false, lastUpdated: null });
  const selectRef = useRef(select);
  useEffect(() => {
    selectRef.current = select;
  });

  // The POLLING sibling of useJsonFetch had neither of the two guards that hook
  // has. It is used by the control room and the Dev Case Studio on an interval,
  // so a request in flight when the panel closes (or when a faster poll starts)
  // ran to completion, kept its server-side child alive, and then wrote `failed`
  // or fresh `data` into an unmounted tree — a "the poll is down" banner that
  // belonged to a screen nobody was looking at. `aliveRef` gates every setState;
  // `inFlightRef` aborts the previous request when a new one starts and on
  // unmount, so the child dies with the screen that asked for it.
  const aliveRef = useRef(true);
  const inFlightRef = useRef<AbortController | null>(null);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      inFlightRef.current?.abort();
    };
  }, []);

  const reload = useCallback(async () => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    try {
      const r = await fetch(url, { signal: controller.signal });
      const body = asRecord(await r.json().catch(() => null));
      if (isLoadFailure(r.ok, body)) throw new Error("load failed");
      if (!aliveRef.current || controller.signal.aborted) return;
      // isLoadFailure is true whenever body is null, so reaching here means it's set.
      setData(selectRef.current(body!));
      setState({ failed: false, lastUpdated: Date.now() });
    } catch {
      // An abort is the caller's own decision (unmount, or a newer poll took
      // over) — never a load failure, and never a banner.
      if (!aliveRef.current || controller.signal.aborted) return;
      setState((s) => ({ ...s, failed: true }));
    } finally {
      if (inFlightRef.current === controller) inFlightRef.current = null;
    }
  }, [url]);

  return { data, state, reload };
}
