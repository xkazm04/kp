"use client";

import { useEffect, useState } from "react";

// One place for the read-only "fetch JSON into state" pattern the dashboard tabs
// all repeated. Handles the cases the hand-rolled copies missed: a non-OK HTTP
// status, a body carrying `{ error }`, and `.json()` throwing on a non-JSON
// (e.g. HTML 500) response. Ignores results after unmount.
export function useJsonFetch<T>(url: string, errorLabel = "Couldn't load this."): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setData(body as T);
      })
      .catch(() => {
        if (alive) setError(errorLabel);
      });
    return () => {
      alive = false;
    };
  }, [url, errorLabel]);

  return { data, error };
}
