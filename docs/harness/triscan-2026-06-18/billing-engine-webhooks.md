# Billing Engine & Webhooks — Tri-Lens Scan
> Total: 5
> Severity: 2 Critical / 2 High / 1 Medium / 0 Low
> Lens: 4 bug / 0 ui / 1 biz

## 1. Idempotency claim committed before the side effect succeeds — a transient apply failure permanently loses the event
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Critical
- **Category**: Webhook idempotency / atomicity
- **Value**: impact 9/10 · effort 4/10 · risk 3/10
- **File**: `app/_lib/billing/sync.ts:65-72`
- **Scenario**: A `subscription.active` (or paid pack) arrives. `insertBillingEvent(event.id, …)` inserts the dedupe row and commits. Then `applyBillingAction` runs and throws (DB lock / `SQLITE_BUSY`, transient I/O, a code path that raises). The route catches it and returns 500, so Polar redelivers — but the redelivery hits `insertBillingEvent` → `fresh === false` → the function returns `{ duplicate: true }` and **skips the apply entirely**. The customer paid; `billing_state` never upgraded and the credits never landed.
- **Root cause**: The idempotency gate (`insertBillingEvent`) and the side effect (`applyBillingAction`) are two independent statements with a commit in between. The "we've seen this" record is written before the work it guards is known to have succeeded. There is no surrounding transaction and no "processed" flag distinct from "received".
- **Impact**: Silent loss of an entitlement or a paid credit grant on any transient apply failure — the worst revenue-integrity failure mode (customer charged, capability withheld), and it is invisible (Polar sees a later 2xx-equivalent dedupe and stops retrying).
- **Fix sketch**: Wrap insert + reduce + apply in a single `db.transaction(...)` so the dedupe row only persists if the apply commits (a throw rolls back the claim, letting the retry reprocess). Alternatively split `received_at` from a `processed_at` flag and treat a row that exists-but-unprocessed as reprocessable.

## 2. `recordMeterUsage` is a non-atomic read-modify-write — concurrent debits over-spend the meter
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Critical
- **Category**: Check-then-act race / entitlement bypass
- **File**: `app/_lib/billing/entitlements.ts:118-131`
- **Scenario**: Two requests for the same workspace pass `meterGate` (or `meterAllowance`) when `remaining === 1`, because the gate is a pure read with no reservation. Both then call `recordMeterUsage`: each reads the same `billingUsageFor` + `creditBalance`, each computes `splitSpend` against the *same* pre-debit balance, and each writes. Net effect: two units consumed against one unit of allowance, or two debits both drawn from the same credit balance (double-spend of prepaid credits). The four meter call sites (`analyze`, `interview/complete`, both `devcase` routes) all do `meterGate → … → recordMeterUsage` with a wide window in between (file persistence, task start, scoring).
- **Root cause**: Enforcement is check-then-act across two separate function calls, and the debit itself (`grantBillingCredits` negative row, then `incrementBillingUsage`) is two unsynchronized statements with no transaction and no atomic compare-and-decrement. SQLite serializes individual writes but not the read→compute→write sequence.
- **Impact**: Free/over-limit premium work; prepaid credits drained below zero under concurrency. On a single-workspace deployment the blast radius is one tenant, but the customer gets capability they didn't pay for (revenue leak) and the credit ledger can go negative.
- **Fix sketch**: Make the debit atomic and conditional: wrap read+split+both writes in `db.transaction`, and gate the included-allowance increment on an `UPDATE … SET qty = qty + ? WHERE …` plus a credit decrement that refuses to drive the balance negative (CAS). Have the route reserve-then-confirm rather than gate-then-debit.

## 3. Subscription writes have no ordering guard — an out-of-order/stale webhook silently downgrades an active plan
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Sync drift / downgrade race
- **File**: `app/_lib/billing/sync.ts:16-43` (apply) · `app/_lib/db/billing.ts:39-74` (unconditional upsert)
- **Scenario**: Polar does not guarantee ordered delivery. A `subscription.updated` carrying `status=past_due` (or an older snapshot) is generated, then a newer `subscription.active` with a later period; network/retry reorders them so the stale event lands last. `upsertBillingState` blindly overwrites every column with the stale snapshot, downgrading a customer who is actually current. The same applies to a late `clear_subscription` (revoked) arriving after a fresh re-subscribe.
- **Root cause**: `applyBillingAction` and `upsertBillingState` are last-writer-wins with no comparison of the incoming event's period/timestamp against the stored `current_period_start` / `updated_at`. The reducer is pure but carries no monotonicity.
- **Impact**: A paying customer is dropped to free (or to `past_due`) by message reordering — entitlement loss mid-period; or a canceled customer stays entitled if the revoke is overtaken. Hard to reproduce, hard to diagnose in support.
- **Fix sketch**: Stamp events with the provider event/period timestamp and make `set_subscription`/`clear_subscription` no-op when the incoming `periodStart` (or event time) is older than the stored one (`WHERE excluded.current_period_start >= current_period_start OR current_period_start IS NULL`).

## 4. A failed/crashed analysis burns the paid AI-candidate unit with no refund — over-charge on the customer's side
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: High
- **Category**: Revenue integrity / units atomicity
- **File**: `app/api/analyze/route.ts:122-124` · `app/_lib/billing/entitlements.ts:118`
- **Scenario**: `recordMeterUsage("ai_candidates")` is debited at task *start*, then `startTask("analyze", …)` runs detached in the background. If the analysis task crashes, the spawn fails (E2BIG, missing Python), the LLM hard-fails, or the user's input was ultimately unusable, the unit is already spent — the recruiter paid for a result they never received, with no automatic refund path. The code comment concedes this ("a failed run burns the unit … refunds are a later nicety").
- **Root cause**: Debit happens optimistically at admission, decoupled from task success, and `grantBillingCredits` has no refund/credit-back call site keyed to a failed `task` id. There is no provider_ref-style idempotent refund for a burned unit.
- **Impact**: Customers are over-charged on the most-watched paid meter (AI candidates) precisely when the product failed them — the highest-friction churn and support-ticket trigger; directly erodes revenue trust.
- **Fix sketch**: Debit on task *success* (move `recordMeterUsage` into the task's completion path), or implement an idempotent refund: on terminal task failure, `grantBillingCredits({ meter, delta:+1, reason:"refund", providerRef:`refund:${taskId}` })` so a retry can't double-refund. Surface the credit-back in Billing for transparency.

## 5. Webhook ingest never enforces that the verified body's content matches the signed `webhook-id`, and unmapped subscriptions are silently ignored — paid-but-dark subscriptions
- **Lens**: 🐛 Bug Hunter (primary; biz secondary)
- **Severity**: Medium
- **Category**: Sync drift / observability gap
- **File**: `app/_lib/billing/polar.ts:53-76,149-162` · `app/_lib/billing/reduce.ts:42-44`
- **Scenario**: (a) `verifyWebhook` signs `${id}.${timestamp}.${rawBody}` then trusts the parsed JSON's `data.product_id`; if `POLAR_PRODUCT_*` env ids drift from the dashboard (e.g. a product recreated, or sandbox ids in prod), `reduceBillingEvent` returns `{ kind:"ignore" }` for an unmapped product and the route still answers 2xx. A genuinely paying subscriber is silently never entitled, and Polar stops retrying because delivery "succeeded". (b) `mapPolarEvent` derives `subscriptionId`/`orderId` purely from payload shape with no assertion the event kind matches what was charged.
- **Root cause**: An "ignore" outcome (unmapped product, unhandled status) is indistinguishable from a successful no-op at the HTTP layer — it returns 200 and is not surfaced to an operator. Product-map drift is a config error treated as benign.
- **Impact**: A misconfigured or post-migration product id turns every new paid subscription into a free experience with no alert; revenue earned but not delivered, discovered only via a customer complaint.
- **Fix sketch**: Have the reducer distinguish "ignore (expected)" from "ignore (unmapped product on a money event)" and have the route log/emit a loud signal (or return non-2xx) for the latter; add a startup/admin check that every configured plan/pack product id resolves. Optionally persist the `ignore` reason on `billing_events` for audit.
