# Billing Engine & Webhooks — Bug Hunter scan

> Context: Entitlement enforcement and the Polar billing gateway — plan reduction, entitlement checks, webhook verification/sync. Gates premium capabilities across the app.
> Files reviewed: 13 of 13
> Total: 7 findings — Critical: 0, High: 2, Medium: 3, Low: 2

## 1. A stale/reordered cancellation can wipe a freshly-active paying customer to free
- **Severity**: High
- **Category**: race-condition
- **File**: `app/_lib/billing/sync.ts:40` (`clear_subscription`), `app/_lib/billing/reduce.ts:62`, `app/_lib/billing/reduce.ts:45` (`subscriptionWriteIsStale`)
- **Scenario**: A customer cancels, then immediately re-subscribes/reactivates within a billing cycle. Polar does NOT guarantee ordered delivery (the code itself documents this at sync.ts:19). The newer `subscription.active` lands first and sets the plan; the older `subscription.canceled`/`revoked` arrives *after* and is reduced to `clear_subscription`, which unconditionally writes `plan=free, status=none`.
- **Root cause**: The out-of-order guard (`subscriptionWriteIsStale`) is applied ONLY on the `set_subscription` branch (sync.ts:26). The `clear_subscription` branch has no staleness/period check at all — it trusts that any ended-status event is the latest word, which the same module elsewhere proves false.
- **Impact**: A paying customer who reactivated loses entitlement and is downgraded to free mid-cycle until the next subscription event re-syncs (which may never come). Revenue paid, product removed — a support-ticket-grade money bug.
- **Fix sketch**: Carry the subscription id + period (or an event/sequence timestamp) into the clear action and refuse a clear whose subscription id matches the stored one but whose period anchor is older than stored. Better: stamp every `billing_state` write with a monotonic `event_seq`/`webhook-timestamp` and reject ANY write (set or clear) that regresses it.

## 2. `past_due` entitles the full plan indefinitely with no grace bound
- **Severity**: High
- **Category**: latent-failure
- **File**: `app/_lib/billing/entitlements.ts:32`
- **Scenario**: A renewal charge fails; Polar sends `subscription.updated status=past_due`. The MoR runs dunning. If the *final* terminal event (`revoked`/`canceled`/`expired`) is ever dropped — delivery failure that exhausts the provider's retry budget, an endpoint outage longer than the retry window, or product-id drift (see #4) — the workspace is stuck on `past_due` forever.
- **Root cause**: `entitledPlan` treats `past_due` exactly like `active` ("a short grace beats cutting a paying customer mid-retry") but encodes NO time bound. There is no `currentPeriodEnd`/grace-window check on the `past_due` branch, unlike the `canceled` branch which at least gates on `currentPeriodEnd > now`.
- **Impact**: Indefinite free service for a customer whose card has permanently failed. The entire entitlement system depends on a single terminal webhook always arriving — a fragile single point of failure for the money path.
- **Fix sketch**: Bound `past_due` by `currentPeriodEnd` plus a fixed dunning grace (e.g. `now <= currentPeriodEnd + 14d`), then fall to free. This makes lost-terminal-event a self-healing degradation instead of a permanent free ride.

## 3. A malformed-but-signed webhook body retries forever (poison delivery)
- **Severity**: Medium
- **File**: `app/_lib/billing/polar.ts:161` (`JSON.parse(rawBody)` inside `verifyWebhook`), `app/api/billing/webhook/route.ts:37`
- **Category**: silent-failure / retry-storm
- **Scenario**: Polar delivers a payload that passes the HMAC (signature is over the exact bytes) but `JSON.parse` throws — e.g. an empty body, a truncated payload, or a future payload shape the parse chokes on. The throw is neither a `WebhookVerificationError` nor a `BillingConfigError`, so the route falls through to the generic `catch` and returns 500.
- **Root cause**: `JSON.parse` happens *after* signature verification but its failure is indistinguishable from a transient apply failure. The route deliberately returns non-2xx on unknown errors so the provider retries — correct for transient I/O, wrong for a deterministically-unparseable body, which will fail identically on every redelivery.
- **Impact**: The provider's webhook queue stalls/backs up on a poison message; legitimate later events may be delayed behind it, and the endpoint logs a 500 storm. No data corruption, but operational noise and potential delivery backlog.
- **Fix sketch**: Wrap the `JSON.parse` in `verifyWebhook`/`mapPolarEvent` and throw a distinct `WebhookVerificationError` (→ 400, no retry) on a body that verified but won't parse — a signed body that isn't JSON is a client/contract error, not a transient one.

## 4. Unmapped-product money events ack 2xx and silently leave a payer un-entitled
- **Severity**: Medium
- **Category**: silent-failure
- **File**: `app/_lib/billing/sync.ts:64` (`ignore` + `unmapped`), `app/_lib/billing/reduce.ts:66`
- **Scenario**: `POLAR_PRODUCT_*` env drifts from the dashboard (a recreated product, sandbox ids shipped to prod, a new plan added in Polar but not in env). A real paying `subscription.active` arrives with a product id not in `productMap()`. The reducer returns `ignore{unmapped:true}`, the apply step logs loudly — but returns 2xx, so the event is marked processed in `billing_events` and never redelivered.
- **Root cause**: The design chooses to ack (2xx) to avoid a redelivery loop on a config error, betting an operator reads the error log. But the dedupe row is now committed, so even after the operator fixes the env, the *original* event will never be reprocessed — only future events re-sync the customer, and a customer mid-period may not generate one for weeks.
- **Impact**: A paying customer silently gets nothing until the next subscription event fires. The "loud log" mitigation depends on someone watching logs in real time; the committed dedupe row makes recovery require manual DB intervention or a forced Polar redelivery.
- **Fix sketch**: For `unmapped` money events, do NOT commit the dedupe row (return non-2xx so the provider redelivers, giving the operator a self-healing window) OR record them in a separate `billing_events_unresolved` table that a reconcile job replays after env is corrected. Treat config-drift on a money event as recoverable, not terminal.

## 5. No customer-id binding: any signed event overwrites the single workspace's plan
- **Severity**: Medium
- **Category**: trust-boundary / tenant-isolation
- **File**: `app/_lib/billing/sync.ts:29` (`upsertBillingState`), `app/_lib/db/billing.ts:39`
- **Scenario**: The model is single-workspace (`billing_state` has one row, id='workspace'). `applyBillingAction` writes whatever `customerId`/`subscriptionId` the verified event carries, with no check that it matches the customer this workspace already belongs to. If the Polar organization ever has more than one customer (e.g. a shared org token, a test customer, or a future multi-tenant move), the *latest* signed subscription event for ANY customer becomes the workspace's plan.
- **Root cause**: Entitlement is keyed on "the org's webhook secret verified this" rather than "this event is for *our* customer". The one-row design conflates "the workspace" with "whatever customer Polar last told us about".
- **Impact**: Low today (single customer per org assumed), but a latent landmine: a stray sandbox/test subscription or a second customer under the same org silently rewrites entitlement. Becomes a cross-tenant entitlement bug the moment the single-customer assumption breaks.
- **Fix sketch**: On the first `set_subscription`, pin `provider_customer_id`; thereafter reject (or route elsewhere) any event whose `customerId` differs from the pinned one. Make the single-customer assumption an enforced invariant, not an implicit one.

## 6. `clear_subscription` keeps the customer id but drops period anchors, breaking future stale-guard
- **Severity**: Low
- **Category**: edge-case
- **File**: `app/_lib/billing/sync.ts:43` (sets `currentPeriodStart/End: null`), `app/_lib/billing/reduce.ts:52`
- **Scenario**: After a clear, `currentPeriodStart` is null. If a stale `set_subscription` for the SAME subscription id then arrives, `subscriptionWriteIsStale` returns false (it bails when `storedPeriodStart` is null, reduce.ts:52), so a stale re-activation re-applies even though the subscription was just ended.
- **Root cause**: The staleness guard relies on a stored period anchor that `clear_subscription` deliberately nulls out, creating a window where ordering protection is disabled.
- **Impact**: Narrow — a stale re-activation arriving right after a legitimate cancel could briefly re-entitle. Combined with #1 this is part of the same "ordering is only half-guarded" theme.
- **Fix sketch**: Preserve the last period anchor (or a last-event timestamp) across a clear so the ordering guard remains armed, or move ordering off period-anchors onto a monotonic `webhook-timestamp` stored on every write.

## 7. Webhook idempotency keys on the transport delivery id, not the business event id
- **Severity**: Low
- **Category**: edge-case / idempotency
- **File**: `app/_lib/billing/polar.ts:53` (`mapPolarEvent` uses `eventId` = `webhook-id` header), `app/_lib/db/billing.ts:78` (`insertBillingEvent` dedupes on it)
- **Scenario**: The idempotency gate dedupes on the `webhook-id` header (the standard-webhooks *delivery* id). For Svix/Polar a redelivery reuses the same `webhook-id`, so this is correct for retries. But if Polar ever emits the *same* business event under two distinct delivery ids (e.g. a manual resend from the dashboard, or fan-out across endpoints), the subscription apply would run twice. Subscription writes are idempotent (upsert), so this is benign for plans — but it's a latent assumption.
- **Root cause**: Pack-credit grants are correctly deduped on the business `order id` (reduce.ts:103, the comment explains why), but subscription state relies on delivery-id dedupe + upsert idempotency rather than an event-level key.
- **Impact**: Effectively none today (subscription upserts are idempotent; credits use order-id dedupe). Flagged so the invariant "every money side-effect is deduped on a *business* key" is explicit and survives a future non-idempotent side-effect being added to the subscription branch.
- **Fix sketch**: Document that subscription applies MUST stay idempotent, or add the payload's own event id to the dedupe key. Keep the order-id ledger dedupe as the model for any new grant-style side-effect.
