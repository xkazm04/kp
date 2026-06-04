// Pure, React-free core of the "empty vs. failed load" contract that lets the
// Dev Case Studio tell a genuinely empty pipeline apart from an outage instead
// of rendering both as the same blank slate. The `useLoader` hook and the
// control-room poll consume these; keeping the rules here (not buried in async
// React) means they can be unit-tested and can't silently regress back into a
// swallowed `.catch(() => {})`.

export type LoadState = {
  // True when the most recent attempt failed (network error, non-OK status, an
  // `{ error }` body, or a non-JSON response). Stays true until a load succeeds.
  failed: boolean;
  // Epoch ms of the last successful load, or null if it has never succeeded — so
  // the UI can show how stale the data behind a failed refresh actually is.
  lastUpdated: number | null;
};

// Classifies a fetch response as a load failure. A failure is ANY of:
//  - a non-OK HTTP status (`ok === false`),
//  - a missing/non-JSON body (`null`, e.g. `res.json()` threw),
//  - a JSON body carrying a truthy `error` field (API-level error envelope).
// This is deliberately strict: the whole point of the feature is that none of
// these may render as an innocuous empty result.
export function isLoadFailure(ok: boolean, body: Record<string, unknown> | null): boolean {
  return !ok || !body || Boolean(body.error);
}

// Collapses several loaders into one banner state for a view that polls more
// than one endpoint (the control room reads status + outcomes). Failed if ANY
// loader failed; `lastUpdated` is the OLDEST successful point across loaders so
// the banner states the most conservative age of what's currently on screen.
// Loaders that have never succeeded contribute no timestamp.
export function aggregateLoadState(states: LoadState[]): LoadState {
  const failed = states.some((s) => s.failed);
  const stamps = states.map((s) => s.lastUpdated).filter((t): t is number => t != null);
  return { failed, lastUpdated: stamps.length ? Math.min(...stamps) : null };
}
