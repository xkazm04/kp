"use client";

// The one read primitive every /one panel uses — GET an EXISTING route, fold the answer
// into loading / ready / error, never into a calm empty list.
//
// Round 5 (motion orchestration): STALE-WHILE-REVALIDATE. The answer lives in a
// module-level last-good cache per URL (panels/readCache.ts, pure + unit-tested), not in a
// component's state, so:
//   - a view mounting on a URL that already answered draws that answer at once (`ready`,
//     `refreshing` while its own request runs) — a sheet push, a tab switch, a step to
//     another answer never flashes a LoadingGap;
//   - `epoch` (bumped after a data act) and a retry re-ask WITHOUT dropping what is on
//     screen; a refresh that fails keeps the data and says so on one quiet line
//     (`refreshFailed`, PanelFrame) instead of swapping the view for an error;
//   - every view on a URL shows the newest answer any of them got (one subscription per URL).
//
// The other rules stand: a non-OK answer keeps its body (`{ code }`), so the panel resolves
// the CODE through useErrorMessage() in the reader's language; a body the parser does not
// recognise is an error, not "nothing here"; views mounting together share ONE request.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createReadStore, foldRead, requestKey, type Raw, type Read } from "./readCache";

export type { Read } from "./readCache";

const store = createReadStore((url) =>
  fetch(url, { cache: "no-store" }).then(async (r): Promise<Raw> => ({ ok: r.ok, body: await r.json().catch(() => null) }))
);

const NONE = () => () => undefined;

/** GET `url` (null = nothing to read yet) and parse it. `parse` returns null for a body it
 *  does not recognise, which is folded into the error state. `parse` must be a module-level
 *  function (stable identity: the parsed result is memoised per parser and body). */
export function useRead<T>(url: string | null, parse: (body: unknown) => T | null, epoch: number): Read<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const key = url ? requestKey(url, epoch, attempt) : null;
  const subscribe = useCallback((l: () => void) => (url ? store.subscribe(url, l) : NONE()), [url]);
  // Server render: nothing is known (the first client frame matches it; the cache fills after).
  const entry = useSyncExternalStore(subscribe, () => (url ? store.get(url) : undefined), () => undefined);
  useEffect(() => {
    if (url && key) void store.request(url, key);
  }, [url, key]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...foldRead(entry, key, parse), retry };
}

/** A count the read did not return renders as a dash, never 0. */
export const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
