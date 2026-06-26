# Billing Engine & Webhooks — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C1/H2/M2/L0

## 1. Reordered `revoked`/`ended` event can downgrade a re-subscribed paying customer to free
- **Lens**: 🌀 Ambiguity
- **Severity**: Critical
- **Category**: webhook out-of-order / revenue leak
- **File**: app/_lib/billing/sync.ts:40
- **Observation**: The out-of-order guard `subscriptionWriteIsStale(...)` is applied ONLY in the `set_subscription` branch (sync.ts:26). The `clear_subscription` branch (sync.ts:40-54) unconditionally writes `plan=free`, and the reducer's `clear_subscription` action (reduce.ts:21, emitted at reduce.ts:62-63) carries only `customerId` — it drops `subscriptionId` entirely, so apply cannot even tell *which* subscription was revoked. Polar explicitly does NOT guarantee ordered delivery (the very reason the staleness guard exists). If a customer churns (`revoked` for `sub_1`) and later re-subscribes (`active` for `sub_2`), a delayed/retried `revoked` delivery arriving AFTER the new `active` wipes the live `sub_2` entitlement to free.
- **Why it matters**: Silent wrongful downgrade of an actively-paying customer — they keep paying Polar but lose all premium entitlement, with no error and no operator signal. This is the mirror image of the bug the `set_subscription` guard was written to prevent, left unguarded in the one direction that costs revenue and trust.
- **Recommendation**: Carry `subscriptionId` (and period) on the `clear_subscription` action and, in apply, skip the clear when the stored `providerSubscriptionId` differs from the revoked one (a newer subscription is active) — mirroring `subscriptionWriteIsStale`. Add a reorder test (revoke `sub_1` after active `sub_2`).
- **Effort**: M

## 2. BYOM plan grants 0 interview minutes — contradicting its own "voice on your own keys, nothing to meter" rationale
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / misleading entitlement
- **File**: app/_lib/billing/plans.ts:58
- **Observation**: The BYOM plan header comment (plans.ts:2-4) states "BYOM runs text AI + voice on the customer's own keys, so there is nothing of ours to meter," and accordingly sets `ai_candidates: null` and `case_designs: null` (unlimited). But `interview_minutes` is set to **0**, not `null` — meaning BYOM (120 CZK) gets zero voice. Because `interview/create` hard-gates on this meter (interview/create.ts:26) and `entitledPlan` returns the BYOM plan, a paying BYOM customer is 402'd on every interview unless they buy a 790 CZK minute pack. Meanwhile interview/create.ts:23-25 calls interview minutes "the one meter with real per-unit cost" — directly contradicting plans.ts's claim that BYOM voice costs kp nothing.
- **Why it matters**: Either (a) it's a bug and BYOM voice should be unlimited (`null`) — a paid plan silently can't do a thing it advertises; or (b) voice genuinely costs kp (telephony/transport) regardless of LLM key — in which case the plan blurb is misleading and the upsell to packs is undocumented. Both are revenue/clarity risks: the cheapest paid tier looks broken or deceptive, and the actual monetization intent for BYOM voice is tribal knowledge.
- **Recommendation**: Decide and document the intent. If voice is free for BYOM, set `interview_minutes: null`; if it has real cost, fix the plans.ts comment to say so and surface the "BYOM voice requires a minute pack" upsell in the UI/docs.
- **Effort**: S

## 3. Interview create-gate checks "any remaining," not "enough for this call" → a single leftover minute unlocks a full voice interview
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: meter under-enforcement / revenue leak
- **File**: app/api/interview/complete/route.ts:147
- **Observation**: `meterGate("interview_minutes")` (interview/create.ts:26) passes whenever `remaining > 0` — it never reserves or checks that the booked call (default 8 min, debited up to `bookedMin * 2` at complete.ts:147) fits the balance. Minutes are debited only at completion, and `recordMeterUsage` clamps the credit debit to the live balance (entitlements.ts:145), so a customer with 1 remaining minute passes the gate and runs a full ~8-16 minute interview; the ledger is debited by only the 1 unit it has, the rest lands as un-funded `billing_usage`. Voice is described as the only meter with "real per-unit cost," so kp pays for the full call.
- **Why it matters**: Bounded but real revenue leak — every meter boundary leaks roughly one full interview's worth of voice minutes (worst case 2× booked) per subscription, on the most expensive meter. The `bookedMin * 2` cap and `?? 8` fallback (complete.ts:144) are unexplained magic numbers governing how much over-spend is tolerated.
- **Why it matters (cont.)**: It also extends the gate→debit TOCTOU already flagged as a tracked residual (entitlements.ts:126-132), but here it's structural (single-call over-consumption), not just concurrency.
- **Recommendation**: Reserve estimated minutes (`bookedMin`) at create-time, or gate on `remaining >= bookedMin`, and document the `2×` cap rationale. At minimum, record the intended over-spend policy so the leak is a decision, not an accident.
- **Effort**: M

## 4. An unmapped PAID subscription is surfaced only by `console.error` — a paying customer stays dark with no durable ops signal
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: retention / config-drift observability
- **File**: app/_lib/billing/sync.ts:64
- **Observation**: When a real paid subscription arrives for a product id not in `POLAR_PRODUCT_*` (env drift / sandbox ids in prod), the reducer flags it `unmapped` (reduce.ts:66-71) and apply logs a loud `console.error` then returns 2xx (sync.ts:64-76). The raw payload is persisted on `billing_events`, but there is no queryable "paid-but-unmapped" flag, metric, or alert — the only signal is a log line nobody is guaranteed to be watching. The subscriber is silently never entitled.
- **Why it matters**: This is the textbook "customer paid, got nothing" failure, and the comment itself anticipates "learning of it from a customer complaint." For a billing system, that's a churn/refund/chargeback risk that should never depend on log-scraping. kp has a known pattern of entitlement gaps going unnoticed.
- **Recommendation**: Persist an explicit `unmapped`/`needs_attention` flag (or a dedicated `billing_alerts` row / metric) on ingest so an admin surface or health check can list paid-but-dark subscriptions; optionally wire a notification.
- **Effort**: S

## 5. `canceled` grace depends on a non-null `currentPeriodEnd` that nothing guarantees or validates
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: undocumented assumption / edge case
- **File**: app/_lib/billing/entitlements.ts:33
- **Observation**: `STATUS_MAP` maps `canceled` with the comment "cancel-at-period-end: stays entitled until periodEnd" (reduce.ts:35), but `entitledPlan` only honors that grace when `state.currentPeriodEnd` is non-null AND parses to a future date (entitlements.ts:33-36); otherwise it falls straight through to `PLANS.free`. `currentPeriodEnd` comes from `str(data.current_period_end)` in `mapPolarEvent` (polar.ts:71) with no validation. If a cancel event omits or malforms that field, a customer who paid through the period end is silently dropped to free *immediately* — the opposite of the promised grace.
- **Why it matters**: The retention lever (don't cut a customer who paid through period end) silently fails on a data shape the code never checks, and the failure mode is invisible (no log, no error). The dependency on Polar always sending a parseable `current_period_end` on cancel is tribal knowledge, not an asserted contract.
- **Recommendation**: Validate/assert `currentPeriodEnd` is present on any `canceled` write (log loudly if missing, like the unmapped path), or fall back to the stored period end rather than free. Document the assumption in BILLING.md.
- **Effort**: S
