---
id: "0023"
title: The allowance is keyed on the subscription anchor, not the calendar month
status: accepted
date: 2026-10-09
supersedes: []
superseded-by: null
tags: [billing, metering, allowance]
sources:
  - app/_lib/billing/plans.ts
  - app/_lib/billing/entitlements.ts
  - app/_lib/db/billing.ts
  - app/_lib/billing/period-anchor.test.ts
  - app/_lib/billing/allowance-carry.test.ts
  - .ai/tasks/2026-09-07-allowance-period-anchor.md
---

## Context

The provider bills on the subscription's anniversary; the included allowance was keyed
on the UTC calendar month (`currentPeriod`). Over ten representative anchors, 9 received
two allowances inside one paid period (`period-anchor.test.ts`, measured before this
change). That is an invisible over-grant. The anchor is already stored
(`billing_state.current_period_start`) and was unused for this purpose. The operator
chose "Re-key, carry usage across the cut-over" (ask 979a5342, 2026-10-09).

## Decision

**The allowance key is the start date of the anniversary window containing `now`.**

- **The clamp.** The window index is the whole months elapsed since
  `current_period_start`; the anniversary day in month M is
  `min(anchorDay, daysInMonth(M))`, never the raw day (a raw-day draft drifted the
  31 January anchor to 1 February). Enforced by `anniversary` and `anchoredWindow`
  (`app/_lib/billing/plans.ts:180`, `:193`); `allowancePeriod` is `plans.ts:209`. The
  key is `YYYY-MM-DD`, which cannot collide with a `YYYY-MM` calendar key.
- **The calendar fallback.** No `billing_state` row, a null or unparseable
  `current_period_start`, or an anchor in the future keeps `currentPeriod`
  (`plans.ts:193`, `:209`).
- **The carry-over.** Usage already debited under a calendar key inside the window is
  added at read time: `allowanceUsed` (`app/_lib/billing/entitlements.ts:219`) sums
  `from_included` of journal rows with a calendar-format `period` and `occurred_at`
  inside the window (`calendarUsageCarried`, `app/_lib/db/billing.ts:403`). Both the gate
  (`meterOverview`) and the debit (`recordMeterUsage`, `entitlements.ts:327`) read it,
  so amount gated and amount debited agree. No schema change, migration or backfill.
  Using `from_included` means a credit-pack debit is never counted as allowance.
  Debits made before the journal existed have no timestamp and cannot be placed in a
  window; they are **not** carried (the journal predates no paying org on the hosted
  deployment that we know of, but we did not verify it).
- Credit packs (`billing_credits`) are untouched. `allowanceWindow(now, state)` follows
  the same key, so the Billing tab's reset date is the end of the anchored window.

## Alternatives that lost

- **Start each org at zero at the switch.** One extra partial allowance per org, once.
- **Keep the calendar month.** 9 of 10 anchors over-granted.

## Consequences

- `period-anchor.test.ts` measures 0 of 10 over-grants on the anchored key;
  `allowance-carry.test.ts` pins the carry, the credit exclusion and the fallback.
- The charge-parity golden changed only in `billing_usage.period` for orgs with a state
  row; quantities, credits and verdicts are byte-identical.
- If the provider renews with a clamped start (31 Jan -> 28 Feb) the stored anchor day
  becomes 28 and the window follows it; that mirrors what the provider bills.

## What would change our mind

- A provider whose subscriptions are all normalised to the 1st (the two keys then coincide).
- Evidence of unplaceable pre-journal usage large enough to matter, which would argue for
  a one-off backfill.
