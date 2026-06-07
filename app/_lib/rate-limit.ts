// Minimal in-process fixed-window rate limiter for the PUBLIC token surfaces
// (idea-3e49abaf). POST /api/offer/[token], POST /api/schedule/[token] and
// POST /api/schedule/invite are side-effect-bearing — a confirm or invite can
// dispatch candidate email — and had no throttling at all: a holder of one
// link (or any caller, for invite) could hammer them to flood notifications
// and impose costs on the comms provider. Tokens themselves are strong
// (192-bit CSPRNG), so this is abuse containment, not guessing prevention.
//
// In-process by design: kp runs as a single Next server process and has no
// shared cache; a Map with lazy sweeping is the proportionate tool. If kp ever
// scales horizontally, swap the store behind the same function shape.

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
let lastSweepAt = 0;
const SWEEP_EVERY_MS = 60_000;

/** Count one hit against `key`. True = allowed; false = over the limit for the
 *  current fixed window. `nowMs` is injectable for tests. */
export function rateLimit(key: string, opts: { limit: number; windowMs: number }, nowMs: number = Date.now()): boolean {
  // Lazy sweep so abandoned keys (one-shot tokens) don't accumulate forever.
  if (nowMs - lastSweepAt > SWEEP_EVERY_MS) {
    for (const [k, w] of windows) if (w.resetAt <= nowMs) windows.delete(k);
    lastSweepAt = nowMs;
  }
  const w = windows.get(key);
  if (!w || w.resetAt <= nowMs) {
    windows.set(key, { count: 1, resetAt: nowMs + opts.windowMs });
    return true;
  }
  if (w.count >= opts.limit) return false;
  w.count += 1;
  return true;
}

/** Best-effort client key for per-IP limiting. Behind a proxy the first
 *  x-forwarded-for hop is the caller; locally everything shares "local", which
 *  still bounds total throughput on the public routes. */
export function clientIpFrom(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") ?? "local";
}

/** User-facing 429 message, shared by every limited route. */
export const RATE_LIMITED_ERROR = "Too many requests — please try again shortly.";
