---
kind: task
status: first-step-landed
opened: 2026-09-07
run: intake-lago-0907
registry_subject: software-engineering/operations/metered-billing/subscription-billing-periods
registry_technique: timezone-anchored-period-dates
size: 3-5 files, ~60-110 lines net, plus a backfill for billing_usage.period
gate: node --import ./scripts/test-alias-loader.mjs --experimental-transform-types --test app/_lib/billing/period-anchor.test.ts app/_lib/billing-gate.test.ts app/_lib/billing/reduce.test.ts
measurable: allowance windows granted per ONE paid billing period, over 10 representative subscription anchors. Today 9/10 anchors grant TWO; the target is 0/10.
---

# Key the allowance on the subscription anchor, not the calendar month

## The state today, measured

`app/_lib/billing/period-anchor.test.ts` (landed, green, 3/3) pins it:

```
  anchor 2026-01-01   allowance windows per paid period = 1   ok
  anchor 2026-01-05   = 2   OVER-GRANT (2026-01, 2026-02)
  anchor 2026-01-12   = 2   OVER-GRANT
  anchor 2026-01-15   = 2   OVER-GRANT
  anchor 2026-01-20   = 2   OVER-GRANT
  anchor 2026-01-28   = 2   OVER-GRANT
  anchor 2026-01-31   = 2   OVER-GRANT
  anchor 2026-02-14   = 2   OVER-GRANT
  anchor 2026-06-30   = 2   OVER-GRANT
  anchor 2026-11-15   = 2   OVER-GRANT

  9 of 10 anchors receive MORE than one monthly allowance per paid period.
```

The allowance ledger is keyed on `currentPeriod(now)` — a UTC **calendar** month,
`YYYY-MM` (`plans.ts`) — at three call sites: `meterOverview` (`entitlements.ts:210`),
`recordMeterUsage` (`entitlements.ts:292`), and the gate that reads through them.
The money is charged on a different boundary: the provider bills on the
subscription's own anniversary.

**The inputs for the fix are already stored and already unused for this purpose.**
`billing_state` carries `current_period_start` and `current_period_end`
(`db/billing.ts:46-47`, written by the webhook reducer at `:147-157`). Today they are
read only by `entitledPlan` for expiry and grace (`entitlements.ts:62,74`) and by
`billingOverview` for display (`:237`). Nothing keys usage by them. So this is a
**re-keying**, not a data-collection change.

## Why it is worth doing, and in which direction it errs

A customer who subscribes on the 20th is billed 20 Jan – 20 Feb and receives the
tail of January's allowance plus the whole of February's inside that one paid
period. The error is an **over-grant**, which is the invisible half of the pair the
registry's `plan-entitlements` golden path names:

> A gate that under-grants generates support tickets; a gate that over-grants
> generates revenue that was never collected and a pricing page that lies. Both are
> defects; only one is visible.

Nobody will report this. It shows up only as margin.

## The change

1. Add `allowancePeriod(state, now)` beside `currentPeriod` in `plans.ts`:
   index the window by whole months elapsed since `current_period_start`, with the
   anniversary day **clamped to the target month's length**.
2. Route the three call sites through it, keeping `currentPeriod` as the fallback
   for an org with no `billing_state` row (free/self-hosted — no provider period
   exists, and the calendar month is the honest default there).
3. Backfill/ço-exist: `billing_usage.period` is a text key, so old `YYYY-MM` rows
   and new anchored rows can share the table. Decide explicitly whether the
   cut-over resets in-flight allowances (it should NOT — a mid-period re-key must
   not hand a customer a third allowance, which is the same defect enlarged).
4. Extend `period-anchor.test.ts`: flip the pinned `9` to `0` and delete the pin.

**The clamp is the part to get right, and it was got wrong once already.** The first
draft of the B arm compared against the raw anchor day-of-month; on the 2026-01-31
anchor that starts the next window on 1 February, reproducing the very drift the fix
exists to remove (measured: naive B 1/10, clamped B 0/10). The anniversary day in
month M is `min(anchorDay, daysInMonth(M))`, never the raw anchor day.

## What would falsify the premise

If the provider's subscription period is not in fact anchored to the subscription
date — e.g. every subscription is normalised to the 1st on the provider side — then
`current_period_start` is always a first-of-month and A and B coincide. Check a real
`billing_state` row's `current_period_start` before starting; the test's 10 anchors
are representative, not observed. The measurement stands on the keying logic either
way, but the *impact* is zero if no real customer is anchored off the 1st.

## Not in scope

Prepaid credit packs. Those live in the `billing_credits` ledger and are
deliberately period-independent (they survive month boundaries by design) — the
re-key must not touch them.
