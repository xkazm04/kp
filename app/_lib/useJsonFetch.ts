"use client";

import { useCallback, useEffect, useState } from "react";

// One place for the read-only "fetch JSON into state" pattern the dashboard tabs
// all repeated. Handles the cases the hand-rolled copies missed: a non-OK HTTP
// status, a body carrying `{ error }`, and `.json()` throwing on a non-JSON
// (e.g. HTML 500) response. Ignores results after unmount.
//
// `reload()` re-runs the request (a retry button on the error state, or a
// refresh after a write) by bumping an internal nonce so the effect refires. It
// keeps whatever data is already rendered — see the note on the callback below.
export function useJsonFetch<T>(
  url: string,
  errorLabel = "Couldn't load this."
): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    // Abort the in-flight request on unmount / url change / reload so a fetch that
    // reaches a server-side CLI child (rediscover, winnability) SIGKILLs that child
    // via request.signal instead of orphaning it to run to completion. The `alive`
    // flag still gates every setState (an abort resolves in the SAME closure, so its
    // guard already reads false); the AbortError is additionally swallowed so a race
    // where the rejection lands before `alive` flips can never surface as an error.
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
        if (!alive) return;
        if (!r.ok || (body && typeof body === "object" && "error" in body && body.error)) {
          setError((body && body.error) || errorLabel);
          return;
        }
        if (body == null) {
          // A 2xx whose body is empty / unparseable JSON would otherwise setData(null),
          // leaving the consumer in a permanent loading skeleton (data===null && error===null)
          // with no retry. These read-only dashboard endpoints always return a JSON object, so
          // an empty body is a server fault — surface it as an error (reload-able) instead.
          setError(errorLabel);
          return;
        }
        setData(body as T);
      })
      .catch((err) => {
        // An abort (unmount / url change / reload) is expected — never surface it as a
        // load failure. Only a genuine fetch/parse failure sets the (reload-able) error.
        if (!alive || controller.signal.aborted || (err as { name?: string })?.name === "AbortError") return;
        setError(errorLabel);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [url, errorLabel, nonce]);

  // Re-run the request. The last-good `data` is deliberately KEPT on the wire:
  // a refresh must never blank content that is already on screen (loading
  // choreography law 2, docs/design/loading-choreography.md) — the new payload simply
  // replaces it when it lands. A retry from the error state has no data to keep,
  // so it still reads as `data === null && error === null` (the loading
  // condition) exactly as before. Done in this handler rather than inside the
  // effect to avoid a synchronous setState in the effect body.
  const reload = useCallback(() => {
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  return { data, error, reload };
}
