# Billing Engine & Webhooks — bug-hunter + ui-perfectionist scan

> Context: Entitlement enforcement and the Polar billing gateway — plan reduction, entitlement checks, webhook verification/sync. Gates premium capabilities across the app.
> Files reviewed: 11 of 13
> Total: 5

## 1. A refunded/disputed minute pack is never clawed back — credits survive the refund

- **Severity**: Critical
- **Triage note**: Promoted High -> Critical at triage: direct, repeatable revenue loss with no operator action required (buy pack -> refund -> keep credits).
- **Lens**: bug-hunter
- **Category**: state-corruption / money
- **File**: `app/_lib/billing/reduce.ts:104-123` (the `order` branch), `app/_lib/db/billing.ts:93-108` (`grantBillingCredits`)
- **Scenario**: A customer buys the `minutes_100` pack → `order.paid` grants +100 `interview_minutes` into `billing_credits`. They then refund/charge-back the order (Polar sends `order.refunded`). `reduceBillingEvent` sees `kind === "order"`, `mapped.kind === "pack"`, then `event.type !== "order.paid"` → returns `{ kind: "ignore", reason: "…not paid yet (order.refunded)" }`. The 100 credits are **never reversed**. `grep -rni refund app/_lib/billing` finds zero refund handling — only unrelated meter-usage comments.
- **Root cause**: The reducer models a pack order as a one-way "paid ⇒ grant" event and treats every non-`order.paid` type as "not yet paid." A refund is the paid signal's inverse, but it collapses into the same benign-ignore bucket, so the credit ledger has a grant path and no debit path.
- **Impact**: Real revenue loss / retained unpaid entitlement: buy a pack, keep the 100 voice-interview minutes, refund the charge. Repeatable and self-service. Minute credits are the one prepaid balance that persists across months, so the granted value is fully spendable before or after the refund.
- **Fix sketch**: Handle `order.refunded`/`order.canceled` on a pack by inserting a compensating negative `billing_credits` row keyed on a distinct `providerRef` (e.g. `${orderId}:refund`) so it debits once and is idempotent. Make the invariant "every credit grant has a matching reversal event type" explicit, and clamp the resulting balance at 0.

## 2. Failed-payment subscription statuses keep the full plan — `unpaid` is a silent no-op, `past_due` is unbounded

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / latent-failure
- **File**: `app/_lib/billing/reduce.ts:29-37,73-92` (`ENDED_STATUSES` / `STATUS_MAP`), `app/_lib/billing/entitlements.ts:32`
- **Scenario**: A card fails and dunning exhausts. Polar (Stripe-lineage statuses) can leave a subscription at `status: "unpaid"` and emit `subscription.updated`. `unpaid` is in neither `ENDED_STATUSES` nor `STATUS_MAP`, so the reducer returns `ignore("unhandled subscription status 'unpaid'")` — a **no-op that leaves the stored `active`/`past_due` row untouched**, and `entitledPlan` keeps granting the paid plan. Separately, `entitledPlan` maps `past_due` straight to the full plan (line 32) with no `currentPeriodEnd`/grace bound.
- **Root cause**: Failed-payment handling is split across two allowlists (reduce's status map, entitlement's status branch) and neither is a denylist, so any status they don't both enumerate defaults to "stay entitled." The whole downgrade depends on a single terminal `revoked`/`ended` event always arriving; if it is dropped (retry budget exhausted, endpoint outage, or the lifecycle simply parks at `unpaid`), the workspace keeps paid features forever for free.
- **Impact**: Indefinite unpaid entitlement for a permanently-failed payer — a standing revenue leak that is invisible (no alert, no state change) precisely because the failing path is an `ignore`.
- **Fix sketch**: Treat `unpaid` (and any unrecognized non-`active` status) as an entitlement-affecting event, not a no-op; bound both `past_due` and `unpaid` by `currentPeriodEnd + fixed_grace`, then fall to free. Drive entitlement off an explicit "entitled statuses" allowlist so an unknown status fails closed.

## 3. [STILL-OPEN] A reordered `active` after a `revoked` re-entitles a canceled customer

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: `app/_lib/billing/sync.ts:60-68` (clear nulls the anchors), `app/_lib/billing/reduce.ts:45-57` (`subscriptionWriteIsStale`)
- **Scenario**: Customer on `growth` (stored `subscriptionId=S`). They cancel; Polar emits an earlier `subscription.updated status=active` (snapshot S) and the terminal `subscription.revoked` (S). Delivery is unordered (the module documents this): `revoked` lands first → `clear_subscription` runs, `clearSubscriptionIsStale(S, S)` is false so it applies, writing `plan=free, provider_subscription_id=NULL, current_period_start=NULL`. The stale `active` lands second → `subscriptionWriteIsStale(stored=NULL, …, incoming=S, …)` short-circuits to `false` on the very first check (`storedSubscriptionId !== incomingSubscriptionId`) → the write **applies** → `plan=growth active`. The canceled customer is re-entitled.
- **Root cause**: The newly-added `clearSubscriptionIsStale` guard only protects the revoke direction. The set-direction guard keys staleness on the stored subscription id + period anchor, but `clear_subscription` deliberately nulls both, disarming it. This is prior-report finding #6, still present — the fix hardened the mirror direction but left this one open, and its true impact (granting unpaid entitlement) is higher than the Low it was filed as.
- **Impact**: A common cancellation reorder silently restores a paid plan to a non-paying customer until the next genuine event re-syncs (which may never come). Grants unpaid entitlement.
- **Fix sketch**: Stamp every `billing_state` write (set AND clear) with a monotonic `event_seq`/`webhook-timestamp` and reject any write that regresses it, instead of relying on a period anchor the clear path erases. Alternatively, on a clear, retain the last subscription id + a `revoked_at` so a subsequent same-id `active` older than the revoke is rejected.

## 4. Pack grant ignores order quantity — a multi-unit purchase is under-delivered

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / money
- **File**: `app/_lib/billing/polar.ts:54-77` (`mapPolarEvent`), `app/_lib/billing/reduce.ts:114-122` (`grant_credits`)
- **Scenario**: `mapPolarEvent` never reads `data.quantity` or the paid line amount (`grep -rni quantity app/_lib/billing` → nothing), and the grant is hardcoded to `PACKS.minutes_100.qty` (100). If the minute pack is ever sold with a quantity > 1 in a single Polar checkout (Polar supports a `quantity` field on one-time products), the customer pays for N×100 minutes but the ledger is credited exactly 100.
- **Root cause**: The pack grant maps a product id → a fixed quantity, treating "one order = one pack" as an invariant that the product configuration, not the code, guarantees. The paid amount/quantity that the customer was actually charged is discarded during normalization.
- **Impact**: Under-delivery of a paid entitlement (customer charged for more than they receive) → support tickets and refund requests. Not currently a revenue loss and only reachable if multi-quantity checkout is enabled for the pack SKU, hence Medium.
- **Fix sketch**: Read `data.quantity` (defaulting to 1) in `mapPolarEvent`, multiply `pack.qty * quantity` in the grant, and add a reduce test asserting a `quantity: 3` order grants 300. Long-term, derive granted units from the paid amount / unit price rather than a hardcoded constant.

## 5. Duplicate "paid-but-dark" alerts pile up for one unmapped subscription

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/_lib/billing/sync.ts:94` (`recordBillingAlert({ kind, detail })`), `app/_lib/db/billing.ts:122-135`
- **Scenario**: A paying subscription whose product id isn't in `productMap()` (env drift) emits `subscription.updated` repeatedly over a period — each a fresh `webhook-id`, so each passes the event-id dedupe gate and hits the `unmapped` branch. `recordBillingAlert` is called with **no `providerRef`**, so its dedupe query (`WHERE provider_ref = ? AND resolved_at IS NULL`) is skipped and a new `billing_alerts` row is inserted every time — N duplicate open rows for the same dark subscription.
- **Root cause**: The dedupe key exists (`recordBillingAlert` supports `providerRef`) but the caller doesn't pass the subscription/customer id, and the event-id gate only dedupes identical deliveries, not repeated distinct events for the same unresolved condition.
- **Impact**: The "paid but dark" worklist becomes noisy/misleading — one misconfiguration reads as many incidents, and resolving one leaves the rest open. Operational only; no money or data corruption.
- **Fix sketch**: Pass a stable `providerRef` (the subscription id, or `unmapped:${productId}`) so repeated events collapse to one open alert, and resolve it when a later mapped event for that subscription arrives.
