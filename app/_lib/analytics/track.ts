// track() — the client half of the Plausible module, in a plain .ts file ON
// PURPOSE: non-JSX modules (session-nav.ts) import it, and the Node test
// runner's type stripping loads .ts but not .tsx — a .tsx-only home broke
// session-nav.test.ts at import time. plausible.tsx re-exports it, so
// components may import either path; the script component + full docs live in
// ./plausible.tsx.

export type TrackProps = Record<string, string | number | boolean>;

type PlausibleFn = (event: string, options?: { props?: TrackProps }) => void;

/** Fire-and-forget Plausible custom event. Silent no-op when the script isn't
 *  running (no NEXT_PUBLIC_PLAUSIBLE_DOMAIN, blocked, or not yet loaded).
 *  Never throws, never blocks, never awaited — analytics must not be able to
 *  break or delay a product flow. Cookieless by construction. */
export function track(event: string, props?: TrackProps): void {
  if (typeof window === "undefined") return;
  const plausible = (window as Window & { plausible?: unknown }).plausible;
  if (typeof plausible !== "function") return;
  try {
    (plausible as PlausibleFn)(event, props ? { props } : undefined);
  } catch {
    /* analytics must never break a product flow */
  }
}
