"use client";

import { useCallback, useEffect, useState } from "react";
import { useErrorMessage } from "./use-error-message";
// The body-failure rule is single-sourced in the React-free load-state module —
// this hook, useLoader and useInfiniteScroll all read the SAME definition of
// "this response is not a usable result".
import { asRecord, isLoadFailure } from "./load-state";

/** What a failed read is: the machine `code` the route answered with (null when
 *  it answered none) plus the HTTP status. Deliberately NOT the server's English
 *  `error` prose — the client resolves the code, per use-error-message.ts. */
export type JsonFetchFailure = { code: string | null; status: number };

/** The hook's failure half as a pure function, so the precedence rule
 *  (code → catalog, else the caller's localized label, never the prose) is
 *  testable without a DOM. Returns null when the response is a genuine success.
 *
 *  A 2xx whose body is empty / unparseable JSON counts as a failure: setting
 *  `data` to null would leave the consumer in a permanent loading skeleton
 *  (data === null && error === null) with no retry. These read-only dashboard
 *  endpoints always answer a JSON object, so an empty body is a server fault. */
export function jsonFetchFailure(ok: boolean, status: number, body: unknown): JsonFetchFailure | null {
  const rec = asRecord(body);
  if (!isLoadFailure(ok, rec)) return null;
  const rawCode = rec?.code;
  return { code: typeof rawCode === "string" && rawCode ? rawCode : null, status };
}

// One place for the read-only "fetch JSON into state" pattern the dashboard tabs
// all repeated. Handles the cases the hand-rolled copies missed: a non-OK HTTP
// status, a body carrying `{ error }`, and `.json()` throwing on a non-JSON
// (e.g. HTML 500) response. Ignores results after unmount.
//
// `reload()` re-runs the request (a retry button on the error state, or a
// refresh after a write) by bumping an internal nonce so the effect refires. It
// keeps whatever data is already rendered — see the note on the callback below.
//
// The failure is KEPT as `{ code, status }` and the rendered `error` string is
// derived from it through the `errors` catalog: pre-fix this hook did
// `setError((body && body.error) || errorLabel)`, i.e. it shipped the server's
// English prose to every locale (the inverted fallback chain use-error-message.ts
// exists to close) on ~25 dashboard surfaces at once. `errorLabel` is now the
// FALLBACK for a code the catalog doesn't know, never the loser of a race with
// `body.error`. Consumers that need to branch on the outcome (a 402 upsell, a
// 429 back-off) read `code`/`status` instead of matching on a message.
export function useJsonFetch<T>(
  url: string,
  errorLabel = "Couldn't load this."
): { data: T | null; error: string | null; code: string | null; status: number | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<JsonFetchFailure | null>(null);
  const [nonce, setNonce] = useState(0);
  const resolveMessage = useErrorMessage();

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
        const body = (await r.json().catch(() => null)) as T | null;
        if (!alive) return;
        const f = jsonFetchFailure(r.ok, r.status, body);
        if (f) {
          setFailure(f);
          return;
        }
        setData(body as T);
      })
      .catch((err) => {
        // An abort (unmount / url change / reload) is expected — never surface it as a
        // load failure. Only a genuine fetch/parse failure sets the (reload-able) error.
        if (!alive || controller.signal.aborted || (err as { name?: string })?.name === "AbortError") return;
        // A transport failure carries no HTTP response: status 0 is the honest
        // "never reached the server", and there is no code to resolve.
        setFailure({ code: null, status: 0 });
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [url, nonce]);

  // Re-run the request. The last-good `data` is deliberately KEPT on the wire:
  // a refresh must never blank content that is already on screen (loading
  // choreography law 2, docs/design/loading-choreography.md) — the new payload simply
  // replaces it when it lands. A retry from the error state has no data to keep,
  // so it still reads as `data === null && error === null` (the loading
  // condition) exactly as before. Done in this handler rather than inside the
  // effect to avoid a synchronous setState in the effect body.
  const reload = useCallback(() => {
    setFailure(null);
    setNonce((n) => n + 1);
  }, []);

  return {
    data,
    error: failure ? resolveMessage({ code: failure.code }, errorLabel) : null,
    code: failure?.code ?? null,
    status: failure?.status ?? null,
    reload,
  };
}
