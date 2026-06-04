"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isLoadFailure, type LoadState } from "./load-state";

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

  const reload = useCallback(async () => {
    try {
      const r = await fetch(url);
      const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
      if (isLoadFailure(r.ok, body)) throw new Error("load failed");
      // isLoadFailure is true whenever body is null, so reaching here means it's set.
      setData(selectRef.current(body!));
      setState({ failed: false, lastUpdated: Date.now() });
    } catch {
      setState((s) => ({ ...s, failed: true }));
    }
  }, [url]);

  return { data, state, reload };
}
