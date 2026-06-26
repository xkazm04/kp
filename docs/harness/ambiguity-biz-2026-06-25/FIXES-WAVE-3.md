# Ambiguity+Business Fix Wave 3 — Revenue leak / billing

> 6 commits, 6 findings closed (2 Critical + 2 High + 2 Medium).
> Baseline preserved: tsc 0 · JS unit 1028 → 1032 · Python untouched · en/cs parity OK. 0 regressions.

The billing surface — where mistakes are silent and cost real money or trust. Each fix closes a way a paying customer is wrongly charged/downgraded, or kp pays for un-funded usage.

## Commits

| # | Commit | Finding | Sev | Files |
|---|---|---|---|---|
| 1 | `42dbe54` | reordered revoke downgrades a re-subscribed payer | C | billing/reduce.ts, billing/sync.ts, reduce.test.ts |
| 2 | `a8d8b68` | "Switch to this plan" downgrade-as-checkout double-charge | C | BillingTab.tsx, en/cs.json |
| 3 | `9fc1483` | interview meter gated on "any remaining", not the booked call | H | billing/enforce.ts, interview/create, billing-gate.test.ts |
| 4 | `c320058` | interview simulator mints paid voice with no meterGate | H | interview/simulate/route.ts |
| 5 | `00aa993` | canceled grace silently cuts to free on an unparseable period end | M | billing/entitlements.ts, billing/sync.ts, billing-gate.test.ts |
| 6 | `be02d70` | paid-but-unmapped subscription only console.error'd | M | db/core.ts, db/billing.ts, billing/sync.ts, billing-gate.test.ts |

## What was fixed

1. **Reordered revoke (C).** The out-of-order guard existed only for `set_subscription`; `clear_subscription` wrote `plan=free` unconditionally and dropped the subscriptionId. Polar isn't ordered, so a delayed `revoked` for an old sub wiped a re-subscribed customer's live entitlement. `clear_subscription` now carries the revoked id and apply skips a clear that targets a *different* subscription than the stored one (mirror of `subscriptionWriteIsStale`).

2. **Downgrade-as-checkout (C).** PlanCard offered a fresh checkout for every non-current paid plan, contradicting "downgrades via portal" and risking a parallel subscription (double-charge). Now a customer with a paid plan changes it via the provider portal (in-place swap/proration); checkout is only the first purchase from free.

3. **Meter under-enforcement (H).** `meterGate` passed on `remaining > 0`, so 1 leftover minute unlocked a full ~8-16 min call with the overage un-funded. Added a `minUnits` option (default 1 → all other callers unchanged); interview/create gates on the booked `GROUNDED_DEFAULT_MIN`.

4. **Simulator (H).** `/api/interview/simulate` minted a real voice session with no meterGate while debiting at `/complete` — unlimited demo calls on the most expensive meter. Now gated like `/create`, on the sim's booked `durationMin`.

5. **Canceled grace (M).** `entitledPlan` honored the period-end grace only when `currentPeriodEnd` parsed to a future date; a null/malformed value dropped a paying customer to free immediately. Now parses defensively and keeps the plan on an unparseable end (a real lapse arrives as `revoked`→free), with a loud write-path log on the data gap.

6. **Unmapped paid sub (M).** A paid subscription for an unmapped product was surfaced only by `console.error`. Added a `billing_alerts` table + `recordBillingAlert`/`listBillingAlerts` — a durable, queryable "paid but dark" worklist an admin surface / health check can read.

## Deliberately deferred (a product decision, not a code fix)

- **BYOM `interview_minutes: 0` (billing finding #2, High).** The plan comment says BYOM voice "runs on the customer's own keys, nothing to meter" (→ should be `null`), but `interview/create` calls minutes "the one meter with real per-unit cost" (→ voice has transport cost regardless of LLM key). These contradict, and resolving it sets BYOM's monetization (unlimited voice vs. a forced minute-pack upsell). Surfaced for the team — not changed unilaterally.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| JS unit (`node --test`) | 1028 | 1032 |
| Python | 694 OK / 4 skip | (untouched) |
| i18n en/cs parity | OK | OK |

## Patterns established (catalogue items 7–9)

7. **Guard BOTH directions of a reordered event.** A staleness guard written for the upgrade direction (`set_subscription`) is incomplete: the revenue-losing mirror (`clear_subscription`/revoke) needs the same id+period check. Carry the discriminating id on every action so apply can compare.
8. **Gate on the action's cost, not "any remaining."** A `> 0` quota check leaks a full unit-of-work when a single action consumes many units. Gate on `remaining >= expectedUnits`, and apply the SAME gate to every path that mints the metered work (create AND simulate).
9. **A money/compliance failure that can't auto-resolve needs a durable, queryable row — not a log line.** `console.error` for "customer paid, got nothing" depends on someone watching logs; a `*_alerts` table makes it a worklist.

## What remains

Billing/revenue tail is essentially closed except the deferred BYOM intent decision. Remaining open themes (INDEX): comms/candidate-experience reliability (W5), GDPR/audit (W4), dark-capability activations (W6), the tenancy read-scoping follow-up (W2 cont.), and the Med/Low tail.
