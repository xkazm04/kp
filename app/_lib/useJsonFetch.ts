"use client";

import { useCallback, useEffect, useState } from "react";

// One place for the read-only "fetch JSON into state" pattern the dashboard tabs
// all repeated. Handles the cases the hand-rolled copies missed: a non-OK HTTP
// status, a body carrying `{ error }`, and `.json()` throwing on a non-JSON
// (e.g. HTML 500) response. Ignores results after unmount.
//
// `reload()` re-runs the request (for a retry button on the error state) — it
// resets to the loading state and bumps an internal nonce so the effect refires.
export function useJsonFetch<T>(
  url: string,
  errorLabel = "Couldn't load this."
): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(url)
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
      .catch(() => {
        if (alive) setError(errorLabel);
      });
    return () => {
      alive = false;
    };
  }, [url, errorLabel, nonce]);

  // Clear to the loading state (so `data === null && error === null` reads true
  // again) and bump the nonce to refire the effect. Done in this handler rather
  // than inside the effect to avoid a synchronous setState in the effect body.
  const reload = useCallback(() => {
    setData(null);
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  return { data, error, reload };
}
