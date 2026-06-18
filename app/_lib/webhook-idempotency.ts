import { createHash } from "node:crypto";

// Request-level idempotency for the PUBLIC inbound webhook. Lead sources retry on
// timeout / fire the same delivery twice; without a dedupe the route records a
// fresh receipt (inflating the Channels liveness signal), fires another
// `re_applied` event, and re-dispatches the candidate acknowledgement — all for
// one real submission. intakeLead already dedupes the ENTRY by email, but the
// side effects above happen before that and per-request.
//
// In-process by design — same rationale as rate-limit.ts (kp is a single Next
// server process with no shared cache). A retry storm arrives within seconds to
// minutes, so a short-TTL Map with lazy sweeping is the proportionate tool; swap
// the store behind these two functions if kp ever scales horizontally.

type Claim = { resetAt: number };

const claims = new Map<string, Claim>();
let lastSweepAt = 0;
const SWEEP_EVERY_MS = 60_000;

/** Default retention for a processed key — comfortably longer than any provider's
 *  retry window, short enough that two genuinely-distinct identical payloads more
 *  than this far apart are processed independently (intakeLead dedupes by email
 *  anyway). */
export const WEBHOOK_IDEMPOTENCY_TTL_MS = 15 * 60_000;

/** Stable idempotency key for a request: the provider's explicit Idempotency-Key
 *  header when present (they own its uniqueness), else a SHA-256 of the raw body
 *  so a byte-identical retry collides. Caller prefixes with the channel token. */
export function webhookIdempotencyKey(rawBody: string, headerKey: string | null | undefined): string {
  const explicit = headerKey?.trim();
  if (explicit) return `h:${explicit.slice(0, 200)}`;
  return `b:${createHash("sha256").update(rawBody).digest("hex")}`;
}

/** Atomically claim `key`. Returns true if newly claimed (the caller proceeds with
 *  the side effects); false if it was already claimed within the TTL (a duplicate —
 *  the caller short-circuits). The check-and-set is synchronous, so a concurrent
 *  retry that arrives while the first request is still awaiting also sees it as
 *  claimed. `nowMs` is injectable for tests. */
export function claimWebhookIdempotency(
  key: string,
  ttlMs: number = WEBHOOK_IDEMPOTENCY_TTL_MS,
  nowMs: number = Date.now(),
): boolean {
  if (nowMs - lastSweepAt > SWEEP_EVERY_MS) {
    for (const [k, c] of claims) if (c.resetAt <= nowMs) claims.delete(k);
    lastSweepAt = nowMs;
  }
  const existing = claims.get(key);
  if (existing && existing.resetAt > nowMs) return false;
  claims.set(key, { resetAt: nowMs + ttlMs });
  return true;
}

/** Release a claim so a genuine retry can re-run it. Call this when processing
 *  FAILED (the route returns 5xx and the provider will retry) — idempotency must
 *  only persist for work that actually succeeded. */
export function releaseWebhookIdempotency(key: string): void {
  claims.delete(key);
}
