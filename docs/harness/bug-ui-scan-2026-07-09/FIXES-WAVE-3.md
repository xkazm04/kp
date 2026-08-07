# Fix Wave 3 — GDPR erasure & the money path

> 3 commits, 2 Criticals + 3 Highs closed (+1 flaky-test repair).
> Baseline preserved: tsc 0 → 0 · node unit 1376 → **1389** (+13) · python 793 OK · i18n 3233 keys × 4 locales in parity · `next build` ✓.

**All 9 Criticals from the scan are now closed.**

## Commits

| # | Commit | Findings | Severity |
|---|---|---|---|
| 1 | `9839572` | privacy-consent-provenance #1, #2 | Critical + High |
| 2 | `7dc4fb5` | billing-engine-webhooks #1, #2, #3 + plans-checkout-billing-ui #1 | Critical + 3×High |
| 3 | `2e1d337` | (test isolation repair) | — |

## 1. Erasure never reached the most sensitive data it held

`anonymizeEntry` scrubbed `pipeline_entries` + events, `profiles`, and `analyses`. It never
touched `interview_sessions.transcript_json` — the candidate's **verbatim voice-interview
answers**, still served afterwards by `/api/interview/by-entry` — nor the comms outbox
(recipient address, subject, personalized body).

Meanwhile `/data/[token]` told the data subject, in writing, that it removes "interview records."
So this was simultaneously a retention breach and **a false statement to the subject**.

The fix enumerated every PII-bearing table from the schema rather than extending the existing
list. Newly scrubbed, in the same synchronous transaction: `interview_sessions`, `dev_outbox`
(by `ref=entryId`), `schedule_invites`, `offers`, `interview_preps`, the onboarding
runs/intake/signatures, `rediscovery_alerts` — **both** `candidate_label` and `prior_label`, a
second leak the new test caught — and `pipeline_entries.notes`, which holds recruiter call-facts
about the candidate and had been retained.

**`decision_records` is deliberately retained.** It is the tamper-evident hash chain kept for
adverse-action defensibility (Art. 17(3)(b)/(e)); scrubbing it would destroy the chain it exists
to prove. Rather than silently keep it, the `/data` copy was reworded in **all four locales** to
state exactly what is removed and to disclose the retained de-identified assessment record and
sealed decision log, with the reason. Legal accuracy over marketing copy.

The `analyses` join is now `LOWER(TRIM(candidate_label)) = ? AND workspace_id = ?`, closing
casing drift and cross-tenant namesake over-scrub. No `entry_id` FK exists, so a *same-tenant*
exact namesake still collides — documented as the safe direction (over-scrub within a tenant,
never under-scrub).

## 2. The money path leaked in four places

- **Critical.** The reducer treated every non-`order.paid` order type as "not paid yet", so a
  refunded 100-minute pack kept its credits. `grep -rni refund app/_lib/billing` returned
  *nothing*. A pack refund now emits `qty: -pack.qty` under a distinct `providerRef`
  (`<orderId>:refund`), so the existing UNIQUE constraint makes a replayed refund debit exactly
  once. Balance floors at 0; the ledger keeps the negative row as a truthful audit record.

  On Polar's `refundedAmount`: **this codebase never reads it.** Rather than guess whether it is
  incremental or cumulative — a trap that has bitten a sibling codebase — the fix reverses the
  whole fixed pack quantity, keyed for once-only application. The pack is one indivisible SKU.

- **High.** `unpaid` was a silent reducer no-op and `past_due` was unbounded in `entitledPlan`,
  so a customer who stopped paying kept full entitlement forever. Both now lapse to free at
  `currentPeriodEnd + FAILED_PAYMENT_GRACE_MS` (7 days), and a missing/unparseable anchor on a
  failed payment **fails closed** to free.

- **High.** A reordered `active` after a `revoked` re-entitled a canceled customer, because
  `clear_subscription` nulled the anchor the staleness guard reads. It now keeps the revoked
  subscription id as a tombstone; a genuine re-subscribe (new id) still applies.

- **High.** The "existing subscribers change plans via the portal, never a fresh checkout"
  invariant — which `harness-learnings.md` records as *hardened* — was enforced only in the
  client. The prior fix added `changeVia` to the PlanCard; nobody guarded the route. A stale tab
  or raw POST minted a parallel subscription and double-charged. The route now reads billing
  state and 403s, pointing at the portal.

### ⚠ Customer-visible behavior changes (need sign-off)

1. **`past_due` is no longer unbounded** — it lapses 7 days after period end. If the
   merchant-of-record's dunning window is longer than 7 days, raise `FAILED_PAYMENT_GRACE_MS`.
   This can revoke a currently-entitled `past_due` customer.
2. **`unpaid` now downgrades to free** (previously kept the plan indefinitely).

## 3. A flaky test, found while verifying

`erasure scrubs PII from the candidate's saved analyses` failed roughly **1 run in 8** in the full
suite while passing 5/5 in isolation. Both erasure tests derived their throwaway SQLite path from
`${process.pid}` and relied on an `after()` sweep. SQLite files stay locked, the sweep swallows
the failure, and tmpdir had accumulated **176 leftover databases** — so a reused PID opened a
stale, already-populated database.

Both now use `mkdtempSync` for a unique directory. Verified with 6 consecutive clean full runs.

This was not hand-waved as "environmental." A test that can fail for reasons unrelated to the code
under test is nearly as bad as one that cannot fail at all — and this scan already found one of
those (`assertGreaterEqual(x, out["qualified"] and 0)`).

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| node unit | 1376 | **1389** (+13) |
| python | 793 OK | 793 OK |
| `i18n:check` | 3233 × 4 in parity | 3233 × 4 in parity |
| `next build` | ✓ | ✓ |
| flaky tests | 1 (1-in-8) | 0 (6 consecutive clean runs) |

## Patterns established (catalogue items 9–12)

9. **A promise to a user is part of the spec.** `/data` claimed erasure removed interview records.
   Either the code must satisfy the claim or the claim must change. Grep user-facing copy for
   commitments the code is expected to honor — it is a requirements source nobody diffs.
10. **Enumerate, don't extend.** The erasure list had grown by accretion, one table at a time. The
    fix started from `CREATE TABLE` and worked forward. Ask "what is the complete set?" not "what
    else should I add?"
11. **A hardened invariant enforced in the client is not hardened.** `changeVia` made the UI do the
    right thing; the route never learned. When learnings say a rule is enforced, verify at the
    boundary an attacker actually reaches.
12. **Don't guess a payment provider's field semantics — check whether you even read it.** The
    `refundedAmount` cumulative-vs-incremental trap was sidestepped entirely by noticing the field
    is never mapped, and reversing a fixed quantity idempotently instead.

## Status

**Criticals: 9 of 9 closed.** Remaining: 62 High, 125 Medium, 30 Low.

Next per the INDEX: Wave 4 — *gates that cannot fail* (`--strict` eval skipping 11 of 13
scenarios; scheduler health that never checks liveness; the tautological winnability assert; the
dropped `paste` authenticity event). Low fix-risk, high assurance value, and the theme this scan
surfaced most often.
