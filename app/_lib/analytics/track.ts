// track() — the client half of the Plausible module, in a plain .ts file ON
// PURPOSE: non-JSX modules (session-nav.ts) import it, and the Node test
// runner's type stripping loads .ts but not .tsx — a .tsx-only home broke
// session-nav.test.ts at import time. plausible.tsx re-exports it, so
// components may import either path; the script component + full docs live in
// ./plausible.tsx.

export type TrackProps = Record<string, string | number | boolean>;

type PlausibleFn = (event: string, options?: { props?: TrackProps }) => void;

/** Path prefixes whose NEXT SEGMENT is a candidate capability token — the credential
 *  itself, not an id: whoever holds `/schedule/<token>` can act as that candidate
 *  (no session is ever involved on these surfaces). Plausible attaches
 *  `u: location.href` to every event it sends, pageviews included, so leaving the
 *  script live here would ship a working credential to a third party on first paint
 *  and park it in that dashboard's page list — and `/apply/<jobId>` additionally
 *  carries `?lead=<token>` in the query string.
 *
 *  ONE list feeds both halves of the module: plausible.tsx ships it as the script
 *  tag's `data-exclude` so no pageview is sent at all, and track() below refuses to
 *  fire from one whatever the caller asks for. It lives in this .ts half because the
 *  Node test runner strips types in .ts but will not load .tsx — the .tsx half cannot
 *  be pinned by a unit test, this can. */
export const TOKENIZED_PATH_PREFIXES = [
  "/schedule/",
  "/interview/",
  "/status/",
  "/data/",
  "/offer/",
  "/invite/",
  "/skill/",
  "/apply/",
] as const;

/** Whether `pathname` is one of the tokenized candidate surfaces above. */
export function isTokenizedPath(pathname: string): boolean {
  return TOKENIZED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Fire-and-forget Plausible custom event. Silent no-op when the script isn't
 *  running (no NEXT_PUBLIC_PLAUSIBLE_DOMAIN, blocked, or not yet loaded), and on
 *  the tokenized candidate surfaces above (the URL Plausible would attach IS the
 *  credential). Never throws, never blocks, never awaited — analytics must not be
 *  able to break or delay a product flow. Cookieless by construction. */
export function track(event: string, props?: TrackProps): void {
  if (typeof window === "undefined") return;
  if (isTokenizedPath(window.location?.pathname ?? "")) return;
  const plausible = (window as Window & { plausible?: unknown }).plausible;
  if (typeof plausible !== "function") return;
  try {
    (plausible as PlausibleFn)(event, props ? { props } : undefined);
  } catch {
    /* analytics must never break a product flow */
  }
}
