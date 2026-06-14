> Total: 4 findings (Crit/High/Med/Low: 0/0/1/3)

Scope: the 14 `billing-entitlements` files from `_scan-plan.json`, plus the supporting `app/_lib/db/billing.ts` store and every repo-wide consumer (routes, runs, tests). The subsystem is in good shape: `meterGate`, `meterAllows`, `activeJobsGate`, `recordMeterUsage`, `meterAllowance`, `entitledPlan`, `billingOverview`, `ingestBillingWebhook`, the gateway/reducer/sync chain, and the Polar/webhook-verify implementation are all wired into live routes (`/api/analyze`, `/api/interview/*`, `/api/devcase/lifecycle*`, `/api/jobs/[id]/publish`, `/api/billing/*`) and covered by `billing-gate.test.ts` / `reduce.test.ts`. Findings below are dedup/cleanup, not abandoned scaffolding.

## 1. Dead export: `isMeter` type guard has no callers
- **Severity**: Medium
- **Category**: dead-code
- **File**: `app/_lib/billing/plans.ts:90-92` (function); re-exported at `app/_lib/billing/index.ts:19`
- **Evidence**: `isMeter` is defined in `plans.ts` and re-exported on the public barrel, but `Grep "isMeter" C:\Users\mkdol\dolla\kp` returns only those two lines — the definition and the barrel re-export. Zero call sites in any route, lib, or `.test.ts` (the billing tests import `isPlanId`/`isPackId` in `checkout/route.ts` but never `isMeter`). Its two sibling guards ARE used: `isPlanId` and `isPackId` are consumed by `app/api/billing/checkout/route.ts:23,25`. No meter value ever arrives from untrusted input — meters are always passed as compile-time `Meter` literals (`meterGate("ai_candidates")`, etc.), so the runtime guard is unreachable by design. Not a "dark capability" backend fn — it is a pure validation helper with no entry point.
- **Impact**: Dead public API surface; invites a future caller to wire validation that nothing needs, and keeps a misleading "meters can come from the wire" signal next to the genuinely-used `isPlanId`/`isPackId`.
- **Fix sketch**: Delete `isMeter` from `plans.ts` and its entry in the `index.ts` export list. No callers to update. If a meter-from-wire path is ever added, reintroduce it then.

## 2. Duplicated "included-allowance-first, then credits" arithmetic across read and write paths
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/_lib/billing/entitlements.ts:55-66` (`meterOverview` remaining calc) and `app/_lib/billing/entitlements.ts:96-110` (`recordMeterUsage` debit split)
- **Evidence**: The accounting rule "consume the month's included allowance before touching the prepaid credit ledger" is encoded twice with the same `Math.max(0, limit - used)` shape. `meterOverview` computes `remaining = Math.max(0, limit - used) + credits` (the read side), and `recordMeterUsage` independently computes `includedLeft = Math.max(0, limit - used)` then `fromCredits = Math.min(Math.max(0, qty - includedLeft), creditBalance)` (the write side). Both fetch `limit`, `used` (`billingUsageFor`), and `credits`/balance from the same `db/billing.ts` accessors. They are two halves of one invariant; a change to the precedence rule (e.g. credits-first, or a per-meter carryover) must be edited in both or the displayed "remaining" silently diverges from what `recordMeterUsage` actually debits. Confirmed both are the only encodings: `Grep "includedLeft|fromCredits"` hits only `recordMeterUsage`; the remaining formula lives only in `meterOverview`.
- **Impact**: Bug risk — read/write drift means the Billing tab could show credits remaining that the debit path never spends from (or vice versa), eroding trust in the meter UI. Maintenance: two edits for one rule.
- **Fix sketch**: Extract a single pure helper, e.g. `function splitSpend(limit: number | null, used: number, credits: number, qty: number): { fromIncluded: number; fromCredits: number; remainingAfter: number }`, and have both `meterOverview` (qty=0 to derive `remaining`) and `recordMeterUsage` call it. Keeps the precedence rule in one place; no DB or signature changes to the exported API.

## 3. Redundant billing-state fetch inside `meterGate`
- **Severity**: Low
- **Category**: duplication
- **File**: `app/_lib/billing/enforce.ts:39-48`
- **Evidence**: `meterGate` first calls `meterAllowance(meter, now)` (entitlements.ts:85, which internally does `getBillingState()` → `entitledPlan` → `meterOverview`), and then, on the not-allowed branch, calls `entitledPlan(getBillingState(), now)` a SECOND time to label the verdict. So a single 402 decision reads `billing_state` twice and recomputes `entitledPlan` twice. `getBillingState()` is a synchronous SQLite `SELECT ... WHERE id='workspace'` (db/billing.ts:21), so this is cheap, but it is a literal double-read on every gated request and a small correctness footgun (the two reads could observe different rows under a concurrent webhook write).
- **Impact**: Minor: redundant DB round-trip on the quota-exceeded path; theoretical read-skew between the allowance check and the plan label.
- **Fix sketch**: Have `meterAllowance` return (or expose a sibling that returns) the resolved `plan` alongside the `Allowance`, or compute `state`/`plan` once at the top of `meterGate` and pass `plan` into a `meterAllowance`-equivalent. Single read per gate call. Same for `activeJobsGate`, which already reads state only once (no change needed there).

## 4. Mixed import paths defeat the "import from index.ts only" barrel contract
- **Severity**: Low
- **Category**: structure
- **File**: `app/_lib/billing/index.ts:1-5` (states the contract) vs. consumers `app/_lib/automation-run.ts:17`, `app/_lib/reasoning-run.ts:1`, `app/api/billing/webhook/route.ts:3`
- **Evidence**: `index.ts`'s header declares "routes and product code import from here and gateway.ts only; polar.ts is an implementation detail behind polarGatewayFromEnv()". In practice imports are split: barrel users are `app/api/analyze/route.ts`, `app/api/billing/{route,checkout,portal,webhook}/route.ts`, `app/api/interview/{create,complete}/route.ts`, `app/api/devcase/lifecycle*`, `BillingTab.tsx`; but `automation-run.ts:17` and `reasoning-run.ts:1` reach into `./billing/enforce` directly, and `webhook/route.ts:3` reaches into `@/app/_lib/billing/gateway` for `BillingConfigError`. `meterAllows` and `BillingConfigError` ARE on the barrel (`index.ts:16` and... `BillingConfigError` is NOT — confirming the gap: `Grep "BillingConfigError" index.ts` → no match, so `webhook/route.ts` is forced to deep-import). This is cosmetic, not dead code, but it weakens the single-seam goal that the module's own docstring sells.
- **Impact**: Low — no runtime effect; erodes the provider-swap hedge (a deep import to `gateway`/`enforce` is one more call site to audit during a Paddle migration) and makes the "public surface" ambiguous.
- **Fix sketch**: Add `export { BillingConfigError } from "./gateway"` to `index.ts`, then repoint `automation-run.ts`, `reasoning-run.ts`, and `webhook/route.ts` at `@/app/_lib/billing`. Purely mechanical; no logic change.
