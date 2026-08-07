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

// The single shared bucket every request collapses to when no TRUSTWORTHY client
// IP is available — i.e. kp isn't behind a declared proxy, so the forwarding
// headers are attacker-supplied and must not mint a fresh bucket each.
const SHARED_CLIENT_KEY = "local";

/**
 * Pure client-key resolution given how many reverse-proxy hops kp sits behind —
 * the security-relevant decision, extracted so it can be unit-tested without
 * process.env (see rate-limit.test.ts). `clientIpFrom` below is the thin
 * env-reading wrapper.
 *
 * TRUST MODEL. `X-Forwarded-For` is a CLIENT-appended list: the left-most entry
 * is whatever the external caller pre-seeded, so trusting it (the old behavior)
 * let a script send a fresh `X-Forwarded-For: <random>` per request and get a
 * fresh limiter bucket every time — defeating the throttle entirely. The only
 * trustworthy hops are the ones YOUR OWN proxy appended, counted from the RIGHT.
 *
 *   - `trustedHops === 0` (kp directly exposed / no proxy declared): the whole
 *     header is forgeable, so it's IGNORED and every request shares
 *     {@link SHARED_CLIENT_KEY}. The throttle becomes a coarse global cap a
 *     spoofed header can't evade — the safe failure for an abuse-containment
 *     control (over-throttle, never under-throttle).
 *   - `trustedHops === N ≥ 1` (kp behind N proxies that each APPEND the address
 *     they saw): the real client is the entry `N` from the right. Clamped to the
 *     left-most hop when the chain is shorter than declared.
 *
 * Falls back to a proxy-set single-value `X-Real-IP` only when trusted and XFF is
 * absent. A Next.js App Router handler exposes no socket peer address, so when
 * untrusted there is no per-client granularity to recover — hence the shared
 * bucket (documented residual: set `KP_TRUSTED_PROXY` in production to restore it).
 */
export function resolveClientIp(xff: string | null, realIp: string | null, trustedHops: number): string {
  if (trustedHops > 0) {
    if (xff) {
      const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
      if (hops.length > 0) return hops[Math.max(0, hops.length - trustedHops)];
    }
    const real = realIp?.trim();
    if (real) return real;
  }
  return SHARED_CLIENT_KEY;
}

/**
 * How many trusted reverse-proxy hops sit in front of kp, from `KP_TRUSTED_PROXY`:
 *   - unset / "0" / junk ⇒ 0 (no proxy trusted; forwarding headers ignored);
 *   - a non-negative integer ("1", "2", …) ⇒ that hop count;
 *   - a truthy word ("true"/"yes"/"on") ⇒ 1 (the common single-proxy deploy).
 */
function trustedProxyHops(): number {
  const raw = process.env.KP_TRUSTED_PROXY?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n;
  return /^(true|yes|on)$/i.test(raw) ? 1 : 0;
}

/** Client key for per-IP limiting, read from the forwarding headers under the
 *  `KP_TRUSTED_PROXY` trust model (see {@link resolveClientIp}). Untrusted by
 *  default, so a spoofed `X-Forwarded-For` can no longer buy a fresh bucket. */
export function clientIpFrom(headers: Headers): string {
  return resolveClientIp(headers.get("x-forwarded-for"), headers.get("x-real-ip"), trustedProxyHops());
}

/** User-facing 429 message, shared by every limited route. */
export const RATE_LIMITED_ERROR = "Too many requests — please try again shortly.";
