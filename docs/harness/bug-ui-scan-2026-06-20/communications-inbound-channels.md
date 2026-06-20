# Communications & Inbound Channels — Bug Hunter scan

> Context: Outbound candidate communications (envelopes, dispatch, delivery status, resend) and inbound channel webhooks/tokens that feed applications into the pipeline.
> Files reviewed: 16 of 17
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. A failed intake retry inflates the receipt count it was built to protect

- **Severity**: High
- **Category**: silent-failure / idempotency-gap
- **File**: `app/api/channels/inbound/[token]/route.ts:97-104,156-163`
- **Scenario**: An integrator POSTs a lead, the route claims the idempotency key (line 97) and immediately calls `recordChannelWebhookReceipt(token)` (line 104), then `intakeLead` throws (a transient SQLite contention, a translator import error, etc.). The `catch` releases the claim (line 159) so the provider's retry can re-run — but the receipt counter was **already** incremented. The retry claims again, increments the receipt **again**, and so on for every retry in the storm.
- **Root cause**: The idempotency guard's stated job (docstring lines 87-92) is to stop a retry from "record[ing] a second receipt." But the receipt write happens *after* the claim and is never undone when processing fails, while the claim *is* released — so on the failure path the claim provides no protection for the one side effect it names first.
- **Impact**: The Channels-tab liveness signal (`received_count`, `lastReceivedAt`) is inflated by every failed retry, making a broken integration look busier than a healthy one and corrupting time-to-first-lead diagnostics.
- **Fix sketch**: Either record the receipt only after the claim is committed *and* keep the claim on infrastructure failures (treat receipt as the durable idempotency anchor), or move `recordChannelWebhookReceipt` after `intakeLead` succeeds so a thrown intake records no receipt. Don't release a claim whose partial side effects (the receipt) survive.

## 2. A still-malformed retry is answered with a misleading idempotent 200

- **Severity**: High
- **Category**: silent-failure / contract-violation
- **File**: `app/api/channels/inbound/[token]/route.ts:97-121`
- **Scenario**: A source posts a payload with no mappable email. The route claims the idempotency key (line 97), records a receipt, then returns `422 {code: "missing_email"}` (line 117) — **without releasing the claim** (only the `catch` releases). The integrator fixes nothing and retries the byte-identical body; it now hashes to the same key, so `claimWebhookIdempotency` returns false and the route replies `200 {result: "duplicate_ignored"}` (line 98) instead of the actionable `422`.
- **Root cause**: The `422` (and the `410 role_closed` / `declined` paths) are non-exceptional early returns, so they bypass `releaseWebhookIdempotency`. The claim is only released on a thrown error, conflating "this exact request was already *successfully* handled" with "this exact request was already *rejected*."
- **Impact**: An integrator debugging a field-mapping bug sees a `200` success on retry and stops investigating — the lead is silently never ingested. The `missing_email` diagnostic, the whole point of the 422, disappears on the second identical send.
- **Fix sketch**: Release the idempotency claim on every non-accepted terminal return (`missing_email`, `role_closed`, and arguably `declined`), or only claim *after* the payload has passed validation and the job is open, so the claim brackets exactly the "real side effects" window.

## 3. Per-process resend guards let two instances send the candidate a duplicate offer/rejection

- **Severity**: High
- **Category**: race-condition / comms-integrity
- **File**: `app/api/comms/[id]/resend/route.ts:11,24-27,38-48`
- **Scenario**: A `failed` offer row is resent. The double-fire guard is an in-memory `Set` (`resendInFlight`, line 11) and the recovery-dedup is a DB read of sibling rows (lines 38-48). If kp runs more than one Node process (or one process is restarted mid-resend, or two recruiters click on different instances), the `Set` is not shared, and two resends can both pass the `alreadyRecovered` read *before* either writes its new outbox row — so the candidate receives two offer (or rejection) emails.
- **Root cause**: Both guards assume a single long-lived process. The recovery-dedup is a check-then-act with no atomic CAS: the window between `listOutboxFiltered(...)` (line 39) and `sendComm` writing the new row (line 49) is unguarded across processes.
- **Impact**: Duplicate candidate-facing offers/rejections — exactly the "must never deliver a duplicate offer/rejection" the code comments warn against (lines 35-37). A duplicate offer with two distinct token links is a real hiring/legal hazard.
- **Fix sketch**: Make the recovery dedup a single atomic DB statement (insert-the-new-row guarded by a `WHERE NOT EXISTS (newer non-failed sibling)` / unique `(ref,kind,recovery)` index), so the dedup is enforced by the database, not a process-local set. Treat the in-flight `Set` as a latency optimization only, never the correctness boundary.

## 4. A slow/failing outbound relay blocks the public inbound webhook response

- **Severity**: Medium
- **Category**: latency / availability
- **File**: `app/_lib/comms.ts:68-86`, `app/api/channels/inbound/[token]/route.ts:123-146`
- **Scenario**: With `COMMS_WEBHOOK_URL` configured, an inbound lead is accepted; `intakeLead` `await`s `dispatchApplicationReceived` → `sendComm` → `WebhookChannel.deliver`, which retries up to 3 times with inline `delay` backoff (200ms, 400ms) plus the fetch timeouts on each attempt. The inbound POST handler is awaiting all of this before it returns to the lead source.
- **Root cause**: The acknowledgement send is performed synchronously inside the request that ingests the lead, and the relay's bounded-but-blocking retry loop has no overall deadline. A flaky relay turns a fast intake into a multi-second hold.
- **Impact**: Lead sources (ad platforms, Zapier) time out and retry, multiplying load; the per-token rate limit (60/min) is consumed by retries of slow requests; under a relay outage the public endpoint's latency degrades for every accepted lead even though the lead itself was already filed.
- **Fix sketch**: The ack is already best-effort (lead-intake swallows its failure). Decouple it from the response — fire-and-forget the dispatch (or queue it) so the webhook returns as soon as the entry is persisted — or cap total dispatch time with an overall abort so one slow relay can't stretch the inbound response unbounded.

## 5. Recovery-dedup read is capped at 100 rows, so an old dead-letter can resend a duplicate

- **Severity**: Medium
- **Category**: edge-case / pagination-drift
- **File**: `app/api/comms/[id]/resend/route.ts:38-41`, `app/_lib/db/devcase.ts:353-376`
- **Scenario**: `alreadyRecovered` calls `listOutboxFiltered({ ref, kind })`, which defaults to `LIMIT 100` ordered `created_at DESC`. For a long-lived pipeline entry with >100 comms of the same kind (busy automation, many reminders), the newer "recovered" sibling can fall outside the 100-row window, so `.some(...)` finds nothing and the resend fires a duplicate the dedup was meant to suppress.
- **Root cause**: A correctness check (has this already been re-sent?) is implemented over a *paginated display query* whose default limit was tuned for UI, not for an existence test. The check silently degrades as history grows.
- **Impact**: For high-volume entries, the server-side duplicate-send guard can be bypassed, re-delivering an offer/rejection/reminder. Low frequency, but it defeats the stated safety property exactly when an entry has the most history.
- **Fix sketch**: Replace the in-memory `.some()` with a targeted `SELECT 1 ... WHERE ref=? AND kind=? AND status!='failed' AND created_at > ? LIMIT 1` (no row cap), so the existence test is exact regardless of history depth.

## 6. Email harvested from an arbitrary field becomes the recipient and stored contact unverified

- **Severity**: Medium
- **Category**: trust-boundary / data-integrity
- **File**: `app/_lib/lead-payload.ts:121-127`, `app/api/channels/inbound/[token]/route.ts:113-146`
- **Scenario**: `extractLead` first tries known email aliases, then falls back to scanning **every** flattened field value for the first email-shaped string (line 126). A payload like `{"email":"victim@corp.com","note":"contact me at attacker@evil.com"}` yields `victim@corp.com` (alias wins), but a payload with no alias key and a planted address anywhere — e.g. a free-text comment field — files the lead under, and dispatches the KO-decline / acknowledgement comm to, that scanned address.
- **Root cause**: The "any value that looks like an address" heuristic (a convenience for creative field names) treats an untrusted body's incidental email as the candidate's contact, with no per-channel field whitelist and no ownership confirmation. The token authenticates the *channel*, not the *email*.
- **Impact**: An unsolicited acknowledgement / KO-decline email is dispatched to an address the submitter merely typed into a field, and a pipeline entry is filed under it. This is a spam/abuse vector through a public endpoint and pollutes the candidate pool with mis-attributed contacts.
- **Fix sketch**: Gate the value-scan fallback behind "no alias key was present at all," and prefer it never to override an alias; consider requiring the email to appear in a designated field for a given channel. At minimum, mark value-scanned emails as low-confidence so downstream sends can suppress until confirmed.

## 7. Webhook create accepts a job with no tenant/ownership scoping by raw id

- **Severity**: Low
- **Category**: auth-gap (within the app's single-tenant trust model)
- **File**: `app/api/channels/webhooks/route.ts:18-38`, `app/_lib/db/channels.ts:74-83`
- **Scenario**: `POST /api/channels/webhooks` takes `jobId` from the body, looks it up with `getJob`, and mints a public receiver bound to it — with no auth check and no scoping beyond "the job row exists." The route comment calls this a "trusted environment," and the app ships no API auth, so this is consistent with kp's model; but the management routes (`GET`/`POST`/`DELETE`) are entirely unauthenticated.
- **Root cause**: The design deliberately treats every workspace API as trusted (no session/tenant layer exists). The token is the only boundary, and it gates only the *receiver*, not webhook *management*.
- **Impact**: If kp is ever exposed beyond a single trusted operator (multi-recruiter, public host), anyone who can reach the API can enumerate/create/revoke inbound webhooks and read every candidate comm via `/api/comms`. Today's blast radius is bounded by deployment, hence Low.
- **Fix sketch**: When/if an auth layer lands, gate the channel-management and `/api/comms` routes behind it and scope `getJob` to the caller's workspace. Until then, document the deployment assumption explicitly so it isn't silently violated by a future hosting change.
