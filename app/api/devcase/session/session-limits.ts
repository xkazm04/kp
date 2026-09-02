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

// ---------------------------------------------------------------------------
// FLUSH BUDGETS (/perfect 2026-09-02, api-devcase-1). `POST /api/devcase/session/[id]`
// — the observed-process flush — carried NO throttle at all while its sibling chat
// route carried two windows. It is a PUBLIC route (public-routes.ts lists the
// /api/devcase/session prefix) that appends event rows and OVERWRITES the session's
// file tree, and its own bounds admit 50 files x 256 KB = 12.8 MB per call. Unbounded
// calls x 12.8 MB is a write-amplification / IO-exhaustion door on an unauthenticated
// surface.
//
// Same two-window shape as the chat route, keyed on the same two things an abuser
// cannot rotate (never the caller's IP: candidates sitting a timed assessment
// legitimately share a NAT, and IP-throttling an assessment surface punishes the
// honest case).
//
//  1. Per SESSION, 200/10min. `LiveWorkSurface` flushes on an 8s interval — 75 per
//     10 minutes — plus one submit flush and the odd retry. 200 is ~2.6x the client's
//     own cadence, so a candidate never meets it while a scripted loop is pinned to
//     20/min instead of unbounded.
//  2. Per apply TOKEN, 60,000/24h. Session-start already caps a posting at 50
//     sessions/day, so this leaves 1,200 flushes per session — about 2.7 hours of
//     continuous 8s flushing each, longer than any timeboxed case runs.
//
// And the third bound, the one the count windows cannot express: BYTES. 60,000
// flushes at the 12.8 MB payload cap is ~768 GB of candidate-controlled body per
// apply link per day, so the counts alone are not a bound on the thing that actually
// costs. The byte budget below caps the aggregate REQUEST BODY a single apply token
// may flush in a day.

// The two COUNT windows are written as literals at the limiter call in the route
// itself (rate-limit-contract.test.ts pins the call site verbatim, and a plain
// non-exported const in a route module is fine — only `export const` is rejected
// there). Only the byte budget needs module state, so only it lives here.

/** Stated byte budget: 4 GiB of flush body per apply token per 24h. At the
 *  50-sessions/day mint quota that is ~80 MB per session — roughly 1,200 full
 *  resends of a 64 KB working tree, i.e. the session's entire flush budget spent on
 *  dirty trees — so an honest candidate cannot reach it, while the abuse ceiling
 *  drops from ~768 GB/token/day to 4 GiB. */
export const MAX_FLUSH_BYTES_PER_TOKEN_DAY = 4 * 1024 * 1024 * 1024;

type ByteWindow = { bytes: number; resetAt: number };
const flushBytes = new Map<string, ByteWindow>();
let lastSweepAt = 0;
const SWEEP_EVERY_MS = 60_000;

/** Charge `bytes` of flush payload against `token`'s daily budget. True = allowed
 *  (the charge landed); false = this apply link has spent its day. Fixed window, same
 *  in-process shape as `rateLimit` — kp runs as one Next server process. `nowMs` is
 *  injectable for tests. */
export function chargeFlushBytes(token: string, bytes: number, nowMs: number = Date.now()): boolean {
  if (nowMs - lastSweepAt > SWEEP_EVERY_MS) {
    for (const [k, w] of flushBytes) if (w.resetAt <= nowMs) flushBytes.delete(k);
    lastSweepAt = nowMs;
  }
  const w = flushBytes.get(token);
  if (!w || w.resetAt <= nowMs) {
    flushBytes.set(token, { bytes, resetAt: nowMs + SESSION_WINDOW_MS });
    // A single body over the whole day's budget is refused on its own request.
    return bytes <= MAX_FLUSH_BYTES_PER_TOKEN_DAY;
  }
  if (w.bytes >= MAX_FLUSH_BYTES_PER_TOKEN_DAY) return false;
  w.bytes += bytes;
  return true;
}
