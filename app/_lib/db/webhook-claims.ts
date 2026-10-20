// The durable half of webhook idempotency: one row per claimed delivery, in the same
// SQLite file that holds the side effects the claim protects.
//
// WHY A ROW AND NOT A MAP. Two of the three doors that reach the lead-intake core are
// at-least-once by construction — the edge drain acks AFTER it applies, the pull pass
// adopts its cursor AFTER a clean page — so a crash between apply and ack replays the
// tail on the next tick. A process-local Map is emptied by exactly that crash, so the
// replay it was supposed to absorb re-filed: a second knockout decline and a second
// rejection email to a real candidate. The registry's posture for this shape is
// at-least-once delivery with DEDUPLICATED EFFECTS, and the mark has to outlive the
// process that made it.
//
// TWO STATES, BOTH WITH AN EXPIRY:
//   inflight — claimed, work running. Held for a LEASE: a crash mid-work leaves the row
//              inflight, and once the lease runs out the next delivery re-runs the work
//              instead of being swallowed as a duplicate of work that never finished.
//   done     — settled after the side effects committed. Held for the DONE-HORIZON, long
//              enough to cover a replay after an install that stayed down for days.
// An expired row of either state is re-claimable, and a lazy sweep deletes expired rows
// (at most once a minute, on the claim path), so the table is bounded by
// (delivery rate x horizon) rather than growing forever.
//
// THE MARK IS A UNIQUENESS-ENFORCED WRITE. claim is ONE statement — INSERT, or take over
// an EXPIRED row via ON CONFLICT ... WHERE — and it succeeded iff it changed a row. Never
// a SELECT followed by an INSERT: two racing deliveries would both read "absent".
//
// THE ROW HOLDS A DIGEST, NEVER THE KEY. The composed keys embed the receiver's raw
// capability token (`inbound:<token>:…`, `agent-report:<token>:…`) and, when a provider
// sends one, its Idempotency-Key header verbatim. Persisting them would write webhook
// secrets to disk where no secret scanner looks, so the store keys on sha256(key) hex.
//
// FAIL CLOSED. Every function here THROWS on a store error. The caller's contract
// (webhook-idempotency.ts) turns a failed claim into a 5xx — the delivery is refused
// and retried, never admitted unchecked.
//
// Schema lives in core.ts (webhook_claims); it is tenancy-EXEMPT (see tenancy.ts).

import { createHash } from "node:crypto";
import { ensureDb } from "./core";

/** How often the claim path may run the expiry sweep. */
const SWEEP_EVERY_MS = 60_000;
let lastSweepAt = 0;

/** The stored identity of a composed claim key: sha256 hex. One-way, so a row can
 *  never hand back the capability token the key was built from. */
export function webhookClaimDigest(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Delete every expired row (either state). Returns the number removed. */
export function sweepWebhookClaims(nowMs: number = Date.now()): number {
  lastSweepAt = nowMs;
  return ensureDb().prepare(`DELETE FROM webhook_claims WHERE expires_at <= ?`).run(nowMs).changes;
}

/** Claim `key` for `leaseMs`. true = newly claimed (proceed with the side effects);
 *  false = a live claim exists (in flight inside its lease, or settled inside its
 *  horizon) and the caller short-circuits as a duplicate. Throws on a store error. */
export function claimWebhookKey(key: string, leaseMs: number, nowMs: number = Date.now()): boolean {
  if (nowMs - lastSweepAt > SWEEP_EVERY_MS) sweepWebhookClaims(nowMs);
  const res = ensureDb()
    .prepare(
      `INSERT INTO webhook_claims (key, state, expires_at, claimed_at)
       VALUES (?, 'inflight', ?, ?)
       ON CONFLICT (key) DO UPDATE
         SET state = 'inflight', expires_at = excluded.expires_at, claimed_at = excluded.claimed_at
         WHERE webhook_claims.expires_at <= ?`,
    )
    .run(webhookClaimDigest(key), nowMs + leaseMs, nowMs, nowMs);
  return res.changes === 1;
}

/** Mark a claimed delivery DONE: its side effects committed, so a replay inside
 *  `horizonMs` is a duplicate. Throws on a store error. */
export function settleWebhookKey(key: string, horizonMs: number, nowMs: number = Date.now()): void {
  ensureDb()
    .prepare(`UPDATE webhook_claims SET state = 'done', expires_at = ? WHERE key = ?`)
    .run(nowMs + horizonMs, webhookClaimDigest(key));
}

/** Give a claim back so a retry re-runs it (the work FAILED). Throws on a store error. */
export function releaseWebhookKey(key: string): void {
  ensureDb().prepare(`DELETE FROM webhook_claims WHERE key = ?`).run(webhookClaimDigest(key));
}
