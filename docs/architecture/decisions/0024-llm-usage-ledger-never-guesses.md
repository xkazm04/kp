---
id: "0024"
title: The usage ledger never guesses a number it cannot measure
status: accepted
date: 2026-09-07
supersedes: []
superseded-by: null
tags: [llm, billing, observability]
sources:
  - app/_lib/llm-usage-ledger.ts
  - app/_lib/db/llm.ts
  - app/_lib/db/analytics.ts
  - app/features/settings/billing/spend/spendUsageFold.ts
  - pipeline/jobfit/llm/monitor.py
  - app/api/llm/usage/route.ts
---

# The usage ledger never guesses a number it cannot measure

## Context

`llm_usage` is the single ledger every money-shaped read bills against — the
billing spend panel, the analytics cost panels, cost-per-hire. Because every
model call routes to *the operator's* keys and a fresh install has none
([ADR 0004](0004-keyless-degradation-is-a-product-property.md)), the ledger has
to distinguish states that all look like **zero cost** but mean different
things:

- a keyless install that ran the deterministic path (zero because nothing was
  billed),
- a real provider call the ledger could not **price** (a provider that reports
  no per-call tokens/cost, e.g. some Azure / grounded paths),
- a real call that **failed** — raised or timed out — and can be metered by
  nobody, and a timeout after a large prompt is the single most expensive call
  there is.

Before this decision these collapsed. A keyless line and a prose-answering
provider showed the same zero-cost row; a call that raised was recorded nowhere
durable; the failure diagnosis Python computed was written onto the NDJSON
sidecar and then thrown away when the sidecar was deleted after ingest. The
temptation each time is to *fill the gap with an estimate* so the totals look
complete.

## Decision

**A row the ledger cannot measure is kept and named, never estimated and never
dropped.** Two mechanisms, one principle:

1. **Unpriceable rows** land with `cost_usd IS NULL` and are counted in a bucket
   *beside* the sum — `unpricedCalls` — never folded into it
   (`app/_lib/db/analytics.ts`, `spendUsageFold.ts`). "We cannot price this
   call" is a stated count, not a fake zero inside the money total.
2. **Unmeterable rows** — a call that failed — carry an explicit
   `outcome` column (`'ok' | 'failed'`) plus a bounded `reason` code. A failed
   row has NULL tokens and NULL cost because the provider reported none; putting
   an estimate in the column the meters bill against would be a guess. `reason`
   is reduced to one lowercase snake_case token at the trust boundary
   (`llm-usage-ledger.ts` `reasonOrNull`; `monitor.py` `_reason_code` /
   `_failure_reason`) so the diagnosis is durable and bounded, not free-form
   provider prose.

Two rules keep the split honest:

- **Every money-shaped read names `outcome = 'ok'` explicitly** rather than
  relying on a filter-free query staying correct. A new row class an existing
  aggregate silently swept into a total would be a worse bug than the one this
  fixed. `outcome` defaults to `'ok'` (NOT NULL) so pre-migration rows and every
  successful call — the whole reason the ledger has numbers — stay counted.
- **Aggregates condition per-aggregate, not in the WHERE**, so a failure stays
  countable as `failedCalls` and is never confused with an unpriced-but-ok row.
  The Activity surface stays unfiltered: it is the one place that must *show*
  the failure.

## Alternatives considered

- **Estimate tokens/cost for failed or unpriced calls** so every row carries a
  number — rejected: an estimate in the column the meters bill against is a
  guess presented as measurement, and it corrupts cost-per-hire.
- **Drop rows that cannot be priced or metered** — rejected: a keyless install
  and a silent-failure storm would then look identical (empty), which is the
  observability gap this exists to close.
- **Keep the failure diagnosis only on the NDJSON sidecar** — rejected: the
  sidecar is deleted after ingest, so the diagnosis was written and thrown away;
  a durable column is the only honest home.
- **A new "failed" row class with no schema signal, relying on callers to
  filter** — rejected: any existing aggregate would silently absorb it. The
  explicit `outcome = 'ok'` predicate at every money read is the cost of not
  having that bug.

## Consequences

**Good.** The billing and analytics surfaces can say "N unpriced, M failed"
instead of a fake zero; a keyless install is distinguishable from a failing
provider; an expensive timeout is recorded, not lost.

**Bad, and accepted.** Every money-shaped query must remember to add
`outcome = 'ok'` — a filter that is easy to forget and that
`llm-usage-outcome` / `spendUsageFold` tests exist to defend. Reads that want
the failure signal have to opt in.

**Do not** add an estimated cost to a failed or unpriced row to "make the totals
add up", and do not remove the `outcome = 'ok'` predicate from an aggregate
because "there are no failed rows yet". The predicate is load-bearing precisely
for the day there are.

## What would change our mind

A provider protocol that returns a reliable authoritative cost for *failed*
calls would collapse the `outcome`/estimate distinction for that provider — but
only for it, and only while the deterministic keyless path
([ADR 0004](0004-keyless-degradation-is-a-product-property.md)) still produces
genuinely unpriceable rows that must stay out of the sum.
