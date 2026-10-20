import { createHash } from "node:crypto";

// Request-level idempotency for the PUBLIC inbound webhook. Lead sources retry on
// timeout / fire the same delivery twice; without a dedupe the route records a
// fresh receipt (inflating the Channels liveness signal), fires another
// `re_applied` event, and re-dispatches the candidate acknowledgement — all for
// one real submission. intakeLead already dedupes the ENTRY by email, but the
// side effects above happen before that and per-request.
//
// DURABLE since challenge-r04: the claim is a row in webhook_claims (db/webhook-claims.ts),
// not a process-local Map. Two of the doors that reach the intake core are
// at-least-once by design — the edge drain acks after it applies, the pull pass adopts
// its cursor after a clean page — so a crash between apply and ack REPLAYS the tail on
// the next tick, and a Map is emptied by exactly that crash. The row survives it.
//
// The contract, per call site:
//   claim   → true: proceed; false: a duplicate, short-circuit. A STORE ERROR THROWS,
//             and every caller claims inside its try, so the delivery answers 5xx and
//             is retried — refused, never admitted unchecked (fail closed).
//   settle  → after the side effects committed: the key is DONE for the horizon.
//   release → the work failed: give the key back so the retry re-runs.
// A claim that is never settled or released (the process died mid-work) expires with
// its LEASE, so the next delivery re-runs instead of being dropped.

import { claimWebhookKey, releaseWebhookKey, settleWebhookKey } from "./db/webhook-claims";

/** How long a SETTLED key stays a duplicate — long enough to cover a replay after an
 *  install that stayed down over a weekend or a holiday (the edge holds unacked events
 *  until the next drain), short enough that the table stays small. A genuinely-new
 *  identical payload after this is processed again (intakeLead dedupes by email). */
export const WEBHOOK_IDEMPOTENCY_DONE_HORIZON_MS = 7 * 24 * 60 * 60_000;

/** The in-flight LEASE: how long an unsettled claim blocks a retry. Longer than any
 *  one delivery's work (a CV upload's extraction included), so a live first run is
 *  never doubled; once it lapses, a claim whose process died is re-runnable. */
export const WEBHOOK_IDEMPOTENCY_TTL_MS = 15 * 60_000;

/** Stable idempotency key for a request: the provider's explicit Idempotency-Key
 *  header when present (they own its uniqueness), else a SHA-256 of the raw body
 *  so a byte-identical retry collides. Caller prefixes with the channel token (the
 *  store persists only a sha256 of the composed key, never the token). */
export function webhookIdempotencyKey(rawBody: string, headerKey: string | null | undefined): string {
  const explicit = headerKey?.trim();
  if (explicit) return `h:${explicit.slice(0, 200)}`;
  return `b:${createHash("sha256").update(rawBody).digest("hex")}`;
}

/** Atomically claim `key`. Returns true if newly claimed (the caller proceeds with
 *  the side effects); false if a live claim exists — in flight inside its lease, or
 *  settled inside the done-horizon (a duplicate — the caller short-circuits). One
 *  uniqueness-enforced write, so a concurrent retry that arrives while the first
 *  request is still awaiting also sees it as claimed. THROWS on a store error — claim
 *  inside the try that answers 5xx. `ttlMs` is the lease; `nowMs` is injectable. */
export function claimWebhookIdempotency(
  key: string,
  ttlMs: number = WEBHOOK_IDEMPOTENCY_TTL_MS,
  nowMs: number = Date.now(),
): boolean {
  return claimWebhookKey(key, ttlMs, nowMs);
}

/** Mark a claimed delivery DONE once its side effects committed, so a replay inside
 *  the horizon — including one after a restart — is a duplicate. Never throws: the
 *  work already happened, and failing the delivery now would make its sender replay
 *  it. A settle that cannot write leaves the claim in flight, which still dedupes for
 *  the lease; the log line is how an operator hears of it. */
export function settleWebhookIdempotency(
  key: string,
  horizonMs: number = WEBHOOK_IDEMPOTENCY_DONE_HORIZON_MS,
  nowMs: number = Date.now(),
): void {
  try {
    settleWebhookKey(key, horizonMs, nowMs);
  } catch (err) {
    console.error("[webhook-idempotency] could not settle a claim; it stays in flight until its lease lapses:", err);
  }
}

/** Release a claim so a genuine retry can re-run it. Call this when processing
 *  FAILED (the route returns 5xx and the provider will retry) — idempotency must
 *  only persist for work that actually succeeded. Never throws: it runs on a failure
 *  path already, and an unreleased claim still lapses with its lease. */
export function releaseWebhookIdempotency(key: string): void {
  try {
    releaseWebhookKey(key);
  } catch (err) {
    console.error("[webhook-idempotency] could not release a claim; a retry waits for its lease to lapse:", err);
  }
}
