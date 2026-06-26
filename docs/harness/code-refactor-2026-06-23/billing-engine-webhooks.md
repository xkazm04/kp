> Total: 5 findings (0c critical, 1h high, 2m medium, 2l low)

## 1. `QUOTA_CODE` constant exists as "the stable branch key" but every consumer hardcodes the `"quota_exceeded"` string literal instead
- **Severity**: High
- **Category**: duplication
- **File**: app/_lib/billing/enforce.ts:23 (definition + barrel export at app/_lib/billing/index.ts:17); literal duplicated in app/features/sub_jobs/DraftsPanel.tsx:42, app/features/sub_jobs/JobPostingModal.tsx:91
- **Scenario**: `enforce.ts:15` documents `code: "quota_exceeded"` as "the stable branch key for the UI", and `QUOTA_CODE` is deliberately re-exported from the barrel. But `grep -rn '"quota_exceeded"' app/` shows the two actual UI branch points (`DraftsPanel`, `JobPostingModal`) compare `p.code === "quota_exceeded"` as a raw literal — neither imports `QUOTA_CODE`. The constant is only ever referenced inside `enforce.ts` itself; no external consumer imports it (`grep -rn "QUOTA_CODE" app/` returns only enforce.ts, index.ts, and the test which also uses the literal). So the barrel export is effectively dead and the "single source of truth" goal is unmet.
- **Root cause**: The constant was introduced to centralize the wire-code, but the producing (server verdicts) and consuming (client branches) sides were never wired to it; client code typed the string by hand.
- **Impact**: The whole point of `QUOTA_CODE` (rename-safety / one definition) is defeated — a future rename of the code would silently break the UI's 402 handling (drafts auto-redirect, job-posting "quota" tone) with no compile error. Dead barrel export adds noise and false confidence.
- **Fix sketch**: Either (a) have the two client branches import and compare against `QUOTA_CODE` (it is plain TS, importable from `@/app/_lib/billing`), making the export load-bearing; or (b) if a shared client/server import is undesirable, drop the unused barrel export and keep the literal documented. Option (a) closes the duplication properly. Do NOT change the wire string value.

## 2. `applyBillingAction` is barrel-exported but only ever called internally within `sync.ts`
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/_lib/billing/index.ts:33 (re-export); definition app/_lib/billing/sync.ts:16
- **Scenario**: `grep -rln "applyBillingAction" app/` returns only `app/_lib/billing/index.ts` and `app/_lib/billing/sync.ts`. Inside `sync.ts` it is called once by `ingestBillingWebhook` (line 106). No route, feature, or test imports it from the barrel. The barrel comment states routes "import from here and gateway.ts only" — `applyBillingAction` is an internal apply step that should not be part of the public money-write surface (the only sanctioned write path is `ingestBillingWebhook`).
- **Root cause**: Exported alongside `ingestBillingWebhook` for symmetry, but it is an implementation detail of the verify→reduce→apply pipeline, not a consumer-facing entry point.
- **Impact**: Widens the public API of the single money-write module unnecessarily; invites a future caller to apply a `BillingAction` outside the idempotency-gated transaction in `ingestBillingWebhook` (the exact bug class the comment at sync.ts:92-99 was written to prevent). Minor barrel bloat.
- **Fix sketch**: Remove `applyBillingAction` (and likely keep `type BillingAction` only if needed elsewhere — it currently has no external consumer either, see finding 5) from the barrel's line-33 export; leave it `export`ed in `sync.ts` for the test if needed, or make it module-private. Keep `ingestBillingWebhook` as the only exported write path.

## 3. `entitledPlan` and `meterAllowance` are barrel-exported but have no production consumer (test-only)
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/_lib/billing/index.ts:11-13 (exports `entitledPlan`, `meterAllowance`)
- **Scenario**: `grep -rn "entitledPlan" app/` filtered to non-billing-dir, non-test files returns nothing — the only callers are `enforce.ts`/`entitlements.ts` via relative import and `billing-gate.test.ts`. Same for `meterAllowance`: `grep -rn "meterAllowance" app/api app/features` is empty; it is consumed only internally by `meterAllows` (enforce.ts:57) and by the test. Routes that need the degrade switch import the thin `meterAllows` wrapper instead (`automation-run.ts`, `reasoning-run.ts`). So both barrel exports are reachable only from tests.
- **Root cause**: Both were exposed "just in case" / for test convenience, but the public API settled on `meterAllows` (boolean) for routes and `billingOverview` for the UI; the raw helpers stayed exported.
- **Impact**: The public surface advertises four entitlement entry points (`billingOverview`, `entitledPlan`, `meterAllowance`, `recordMeterUsage`) when only two (`billingOverview`, `recordMeterUsage`) are actually used by app code. Encourages call sites to bypass the intended `meterAllows`/`meterGate` enforcement seam. Tests can import directly from `./billing/entitlements.ts` (the test already imports `enforce.ts` and `entitlements.ts` by relative path — billing-gate.test.ts:52-57), so dropping the barrel re-exports costs nothing.
- **Fix sketch**: Remove `entitledPlan` and `meterAllowance` from the barrel re-export (keep them `export`ed in `entitlements.ts`); the test imports them via the relative path it already uses. Do NOT remove the functions — `meterAllowance` is live behind `meterAllows`, and `entitledPlan` is live behind every gate. This is purely barrel-hygiene; no gating logic changes.

## 4. Stale "removed" tombstone comment for `refundMeterUsage`
- **Severity**: Low
- **Category**: cleanup
- **File**: app/_lib/billing/entitlements.ts:154-156
- **Scenario**: A 3-line trailing comment documents the removal of a `refundMeterUsage` function ("refundMeterUsage removed: ... See app/_lib/analyze-run.ts."). `grep -rn "refundMeterUsage" app/` returns only this comment — the function is gone and nothing references it. This is a removal-changelog note left in source.
- **Root cause**: Defensive note left to explain why a refund path no longer exists, anticipating the "where's the refund?" question.
- **Impact**: Cosmetic. Mild rot — over time these tombstones accumulate; the rationale belongs in the commit/PR or docs/BILLING.md, not as a permanent source comment. The "billing-engine #4" / refund follow-up is also referenced in the RESIDUAL block (entitlements.ts:126-132), so the context is preserved elsewhere.
- **Fix sketch**: Delete the comment (the git history and the RESIDUAL block already carry the rationale), or fold a one-liner into docs/BILLING.md if the design decision needs to be discoverable.

## 5. Barrel re-exports `BillingAction` type with no external consumer
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/billing/index.ts:32 (`export { reduceBillingEvent, type BillingAction } from "./reduce"`)
- **Scenario**: `grep -rn "BillingAction" app/` outside `reduce.ts`/`sync.ts`/`index.ts`/tests returns nothing. `reduceBillingEvent` itself is also only used internally by `sync.ts` (and the test, which imports `reduce.ts` directly). Neither the type nor the function is imported from the barrel anywhere — both are internals of the verify→reduce→apply pipeline whose sole public entry is `ingestBillingWebhook`.
- **Root cause**: Re-exported for completeness when the reducer module was added to the barrel; consumers never materialized because routes only ever call `ingestBillingWebhook`.
- **Impact**: Same class as findings 2 and 3 — overstated public API on the money module. Pure noise; no behavior risk.
- **Fix sketch**: Drop `reduceBillingEvent` and `type BillingAction` from the barrel (line 32), keeping them exported in `reduce.ts` for the test's relative import. Combined with finding 2, this leaves the barrel's write-path surface as just `ingestBillingWebhook` + `IngestResult`, matching the documented "ingestBillingWebhook is the webhook route's whole job" intent.
