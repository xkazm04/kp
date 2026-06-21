# High Fix Wave 9 — comms-inbound idempotency

> 2 idempotency findings on the public inbound lead webhook closed in 1 commit, by
> **re-bracketing the idempotency claim and the receipt** around the real side-effects
> window. Baseline preserved: tsc **0**, `next build` ✓, unit **1019/1019**.

## The bugs (both in `app/api/channels/inbound/[token]/route.ts`)

The handler did: **claim → record receipt → validate email → intake → (terminal)**, with the
claim released only on a thrown error. Two failure modes fell out of that ordering:

1. **Malformed retry got a misleading 200.** The `missing_email` 422 was returned *after* the
   claim and never released it, so a byte-identical retry hit the held claim and got
   `duplicate_ignored` 200 — the field-mapping diagnostic vanished and the lead was silently
   never ingested.
2. **Failed-intake retry inflated `received_count`.** The receipt was recorded right after the
   claim; on a thrown `intakeLead` the catch released the claim but the receipt survived, so
   every retry in a storm re-claimed and re-incremented the Channels liveness counter.

## The fix (commit `cecb33b`)

Reordered to: **validate (role-open, JSON, mappable email) → claim → intake → record receipt
→ (terminal)**.

- The idempotency claim is taken **only after the deterministic validations pass**, so a
  malformed/closed retry sits *outside* the claim — it re-validates and re-gets its actionable
  422/410 every time. (#2 fixed.)
- The receipt is recorded **only after intake reaches a terminal outcome** (accepted/declined).
  A thrown intake records no receipt and releases the claim, so the retry re-runs intake
  without double-counting; a true duplicate 200s on the held claim before reaching the
  receipt, so it's counted exactly once. (#1 fixed.)

The claim now brackets exactly the real side-effects window (`intakeLead` + receipt + accepted
stamp), and `intakeLead`'s own by-email entry dedupe is unchanged.

## Documented semantic shift
`received_count` now counts deliveries that **reached intake** (accepted or declined), not
pre-intake rejects (`missing_email` / `role_closed`). That's the finding author's recommended
behavior (sketch #1b) — the receipt is the durable per-delivery anchor, not a raw-POST tally —
and it removes the inflation that made a broken integration look busier than a healthy one. The
separate `accepted` counter (real new candidates) is unchanged.

## Not done (separate, needs infra)
- **Per-process resend dedup** (`/api/comms/[id]/resend`) — two server instances can each send
  a duplicate offer/rejection. This genuinely needs a SHARED dedup store (the in-process Map
  can't coordinate across instances); deferred until kp runs multi-instance or gets a shared
  cache (the idempotency module's own comment flags this same single-process limitation).
- **A route-level integration test** — the orchestration is verified by review + tsc + build,
  and the primitives (`webhook-idempotency`, `lead-payload`) are unit-tested, but a faithful
  end-to-end test needs the real-DB shim + a mocked `next-intl` server; logged as follow-up.

## Pattern catalogue additions
37. **Claim idempotency around the real side effects, not the whole request.** Deterministic
    rejections (bad input, closed resource) must sit *outside* the claim so a retry re-gets the
    actionable error instead of a stale "duplicate" success.
38. **A durable side effect inside a released claim double-fires.** If you release the claim on
    failure for retry, anything you wrote before the failure (a counter, an event) repeats — do
    the durable write only once the work reaches a terminal, non-retried outcome.
