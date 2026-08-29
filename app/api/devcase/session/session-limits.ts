// bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #2): a per-token/day session
// throttle. Apply tokens are shareable public links, so an unauthenticated holder could
// mint unbounded sessions (each then flushing events) — a cheap storage-exhaustion vector.
// The cap is generous vs. legitimate use: one posting rarely sees this many genuine live
// starts in a day, so real candidates are never blocked.
//
// These live in a sibling module rather than in `route.ts` because Next's generated
// route types reject any non-handler `export const` in a route module (`Type '50' is
// not assignable to type 'never'`), which aborts `next build` after compile and stops
// `.next/standalone` from ever being emitted. See backlog item 57.

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_SESSIONS_PER_TOKEN_DAY = 50;
