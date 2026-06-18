# Tri-Lens Fix Wave 3 — Billing Integrity (theme T3)

> 4 atomic fix commits, 4 criticals closed.
> Baseline preserved: tsc 0 → 0 · unit tests 951 → 951 · i18n 2418 keys parity · 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18`.

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `499c5ee` | billing-engine-webhooks #1 — idempotency before side effect | Critical | billing/sync.ts |
| 2 | `7bf1253` | billing-engine-webhooks #2 — non-atomic meter debit | Critical | billing/entitlements.ts |
| 3 | `03476c7` | job-postings-lifecycle — active-job cap race | Critical | api/jobs/[id]/publish/route.ts |
| 4 | `6e9e8c6` | billing-ui #1 — silent post-checkout | Critical | api/billing/checkout/route.ts, BillingTab.tsx, en/cs.json |

## What was fixed

1. **Webhook idempotency moved inside the apply transaction (genuinely exploitable).** `insertBillingEvent` committed the dedupe row *before* `applyBillingAction` ran. A transient apply failure → 500 → the provider's redelivery hit the dedupe row → skipped the apply forever: **customer paid, plan never upgraded / credits never landed.** Now insert + apply share one `db.transaction`; a throw rolls back the dedupe row so the retry reprocesses. This was a real silent-revenue-loss bug.

2. **Atomic + CAS meter debit.** `recordMeterUsage` did read → split → grant-negative-credits → increment-usage as four unsynchronized statements. Wrapped in one `db.transaction` and clamped the credit decrement to the live balance (never over-draw below zero; no half-applied debit if a statement fails).

3. **Atomic publish cap check.** The free-plan active-job gate was a `countPublishedJobs()` → `setJobStatus()` check-then-set. Wrapped the count check + status flip in one `db.transaction` so two publishes can't both pass at the cap boundary.

4. **Post-checkout confirmation + refresh (genuinely user-visible).** The `?billing=success` return URL was consumed nowhere — a paid recruiter saw their old plan and no confirmation. Now checkout returns to `/?tab=billing&billing=success`; BillingTab shows a "confirming…" banner, re-polls the overview at 2s/5s (the webhook settles the plan shortly after redirect), shows "you're all set — plan is now X", and strips the flag.

## Honest note: better-sqlite3 is synchronous

`better-sqlite3` runs every statement synchronously, and the critical sections in #2 and #3 have **no `await` between the read and the write** — so in this single-process app the meter ledger could not actually over-draw and the publish cap could not actually be bypassed *today*. Fixes #2 and #3 are therefore **hardening**: the transactions make the invariants explicit and DB-enforced, and protect against the day an `await` (or a second connection / horizontal scaling) is introduced into those sections. The CAS clamp in #2 is a genuine integrity improvement regardless. **#2 carries one real residual** that the synchronous model does *not* close — the **gate→debit window**: `meterAllowance()` (early) and `recordMeterUsage()` (after the awaited work) straddle awaits, so two in-flight requests can both pass the allowance gate at the last unit and each do full (non-degraded) work — one extra unit of full-quality work, not a corrupted ledger. Closing it needs a reserve-then-confirm gate across the 4 spend sites + the failed-run refund (billing-engine #4); tracked as a follow-up. #1 and #4 were genuinely live bugs.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `node --test app/**/*.test.ts` | 951 | 951 |
| `node scripts/i18n-check.mjs` | parity | 2418 keys, parity |

(Existing billing tests — reduce, webhook-verify, billing-gate — stay green; the fixes are transaction-wrapping + UI, covered by the suite + tsc.)

## Patterns established (catalogue, continued)

8. **Idempotency claim belongs *inside* the side-effect transaction.** A dedupe row committed before the work it guards turns a transient failure into permanent loss on retry. Claim + apply in one tx, or split received_at from processed_at.
9. **Synchronous SQLite hides check-then-act bugs — but don't rely on it.** With no `await` in the critical section, read→compute→write is atomic by accident of the runtime. Wrap it in a transaction so the invariant survives a future refactor, and find the *real* residual (a window that spans awaits).
10. **Consume the return URL.** A provider success redirect that nothing reads is a conversion + trust bug; confirm + poll-until-settled at the destination.

## What remains (per INDEX)

- **Billing follow-ups (not this wave):** reserve-then-confirm gate + failed-run refund (#4 High), out-of-order subscription downgrade guard (#3 High), unmapped-product loud signal (#5 Med), `GET /api/billing` try/catch (billing-ui #4 Med), quota-wall upgrade CTA (billing-ui #5 Med), billing tenancy (rolled into the deferred tenancy threading).
- **Next themes:** T5/T6 pipeline-state + unwired (4C), T4 AI quality (4C), T7/T8/T10 durability/XSS/timezone (4C), T9 conversion (3C), T11 UI polish.
