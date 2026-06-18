# Tri-Lens Fix — High Wave 1: Billing hardening

> First High-tier wave (continues critical Wave 3). 4 atomic commits, **5 High findings closed.**
> Baseline preserved: tsc 0 → 0 · TS unit tests 957 → 960 (+3) · 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18`.

## Commits

| Commit | Finding | Severity | Files |
|---|---|---|---|
| `46d1163` | billing-ui #2 — checkout/portal public when password unset | High | api/billing/portal/route.ts, checkout/route.ts |
| `9e08f9e` | billing-ui #4 — GET /api/billing no try/catch | High | api/billing/route.ts |
| `675bc4e` | billing-engine #3 + #5 — out-of-order downgrade · unmapped product | High ×2 | billing/reduce.ts, sync.ts, reduce.test.ts |
| `5cfccc4` | billing-engine #4 — failed analysis burns the unit | High | billing/entitlements.ts, tasks.ts, api/analyze/route.ts |

## What was fixed

1. **Operator gate on checkout + portal.** Both routes did no own session check — gated only by `proxy.ts`, which is skipped when `KP_OPERATOR_PASSWORD` is unset. An unauth caller could mint a live customer-portal URL (cancel the subscription, see invoices/PII) or spin up checkouts. Added `requireOperator()` (no-op in open dev mode, enforced when set).

2. **Billing overview error boundary.** `billingOverview()` runs synchronous SQLite reads with no try/catch — a transient/locked DB returned an unframed 500 (internals can leak) and a dead-end UI. Wrapped + stable framed 500, mirroring the analyses route.

3. **Out-of-order subscription guard.** Polar doesn't guarantee ordered delivery, so a stale `subscription.updated` (older period) could land after the newer renewal and overwrite a current customer to a worse plan. `applyBillingAction` now refuses a `set_subscription` whose `periodStart` is older than the stored one for the SAME subscription (a re-subscribe — different id — or a missing anchor still applies). Pure, tested `subscriptionWriteIsStale()`.

4. **Unmapped-product loud signal.** A subscription event whose product id isn't configured (`POLAR_PRODUCT_*` drift) left a paying subscriber silently un-entitled and returned a benign 2xx. The reducer marks it `unmapped`; apply logs it loudly (still 2xx — a config error won't fix on retry).

5. **Failed-analysis refund.** The AI-candidate unit is debited at task start; a terminal failure (crash / spawn-fail / LLM-hard-fail) charged for a result never delivered. Added idempotent `refundMeterUsage(meter, taskId)` (credit keyed to the task id, ON CONFLICT DO NOTHING), called from the analyze task handler's catch.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `node --test app/**/*.test.ts` | 957 | 960 (+3) |

New tests: unmapped-product flag + `subscriptionWriteIsStale` (reduce.test).

## Billing theme — remaining

- billing-ui #5 (quota-wall upgrade CTA — Med), billing-engine #4-residual (the gate→debit reserve-then-confirm window, the deeper half of the Wave-3 residual), billing tenancy (rolled into the deferred tenancy threading), webhook composite-cursor for the cross-instance dedup (out of local scope). All non-critical.

## High tail — status

This is the first of the High-tier waves. ~90 Highs remain across the INDEX themes (auth-hardening, decision-record integrity, AI-robustness, data-integrity, UI/a11y, scheduling, dev-hiring). Each per-context report lists its Highs; the critical-wave docs' "what remains" sections point at the same-context follow-ups.
