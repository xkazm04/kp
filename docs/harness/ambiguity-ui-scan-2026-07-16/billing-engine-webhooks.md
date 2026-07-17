# Billing Engine & Webhooks — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. Per-workspace billing read contradicts the "single shared ledger" design — a non-default team is silently gated to Free
- **Severity**: High
- **Lens**: ambiguity
- **Category**: tenancy-model-conflict
- **File**: `app/_lib/db/billing.ts:25` (read), `app/_lib/billing/enforce.ts:71` (caller), `app/api/analyze/route.ts:52` (real caller passing a non-default workspace)
- **Scenario**: `getBillingState(workspaceId)` does `SELECT * FROM billing_state WHERE id = ?`. The only row ever written lives at `id = "workspace"` (`upsertBillingState` hard-codes `WORKSPACE = "workspace"`, db/billing.ts:72 = `DEFAULT_WORKSPACE_ID`). `meterGate` passes `opts.workspace`, and `analyze/route.ts` already calls `meterGate("ai_candidates", { workspace })` with `workspace = await currentWorkspace()`. Under `KP_MULTI_WORKSPACE`, team B's session yields a workspace id ≠ `"workspace"`, so the read finds no row → `entitledPlan(null)` → **Free plan**, and team B's analyze gate 402s inside a paying org.
- **Root cause**: The read was made workspace-scoped as a "tenancy arc" seam, but `tenancy.ts:167-172` explicitly declares billing a single per-org/deployment ledger ("one subscription + ledger... correctly SHARED across an org's teams"), and `billing_usage`/`billing_credits` reads (`billingUsageFor`, `creditBalance`) are NOT workspace-scoped. So the *plan* is resolved per-team while the *meter it is compared against* stays global — two different tenancy models in one decision.
- **Impact**: A second team in a paid org is wrongly downgraded to Free limits (blocked AI-candidate runs / job cap). The comments call the param "byte-identical" and a safe seam, which is true only while every caller passes the default — a claim the analyze route already violates in spirit.
- **Fix sketch**: Make the billing read match the documented shared-ledger intent: either drop the `workspace` parameter from `getBillingState`/`meterGate` (billing is per-org, resolve it from the org, not the team workspace), or resolve the workspace id to its owning org's billing key before the `SELECT`. Do not ship a plan-read scoped by team while usage/credits stay global.

## 2. `canceled` with a missing/unparseable period end entitles the plan forever — no time bound, unlike `past_due`
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: unbounded-entitlement-leak
- **File**: `app/_lib/billing/entitlements.ts:59`
- **Scenario**: In the `canceled` branch, when `currentPeriodEnd` is null/unparseable the function `return plan` with no cutoff. A `canceled` row whose end never parses keeps the customer on the paid plan indefinitely.
- **Root cause**: Deliberate "don't cut a paying customer on a data gap" choice, but it is asymmetric with `past_due`/`unpaid` (line 47-48), which fail *closed* to Free on a bad anchor and are additionally bounded by `FAILED_PAYMENT_GRACE_MS`. The `canceled` path has neither a fail-closed nor any time bound. Its safety net is "a genuinely-lapsed sub arrives as `revoked` → free" — which depends on that single terminal webhook actually being delivered and processed.
- **Impact**: If the terminal `revoked`/`ended` delivery is dropped or never retried (the exact loss the 7-day grace was designed to bound elsewhere), a canceled workspace keeps premium entitlement permanently, silently. `sync.ts:47` logs the gap only at write time; a row that goes stale afterward is invisible.
- **Fix sketch**: Bound the unparseable-`canceled` case the way `past_due` is bounded — fall back to `updatedAt + one billing period` (or the same grace window) as the cutoff rather than entitling forever — and/or `recordBillingAlert` on a canceled row with no parseable end so an operator has a durable worklist item, not just a one-shot log line.

## 3. Refund clawback trusts the refund event's own `quantity`; a payload that omits it under-claws multi-unit orders
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-assumption
- **File**: `app/_lib/billing/reduce.ts:154` (grant) and `:189` (refund `qty: -units`), via `app/_lib/billing/polar.ts:81`
- **Scenario**: Both grant and refund compute `units = mapped.qty * (event.quantity ?? 1)`, and `mapPolarEvent` reads `data.quantity` (default 1). A 3-unit pack order grants +300. The refund path assumes the `order.refunded`/`order.canceled` payload repeats the same `data.quantity`; if Polar's refund shape carries quantity on order *line items* (not top-level `data.quantity`), `posInt` falls back to 1 and the reversal is only −100.
- **Root cause**: The reversal derives its magnitude from the *refund* event instead of from the original grant. The comment asserts "the order object carries the same quantity on the refund event as on order.paid," but that is an unverified claim about Polar's wire shape (polar.ts:11-12 itself says to validate against sandbox). Tests only feed hand-built refund events that explicitly set `quantity` (reduce.test.ts:158-162), so they cannot catch a real payload that omits it.
- **Impact**: A refunded/disputed multi-unit pack leaves 200 unearned prepaid minutes on the account — real money the customer got back but still can spend.
- **Fix sketch**: Reverse against the original grant, not the refund event: sum the prior `billing_credits` rows for `${orderId}` and negate that total, or persist the granted qty keyed by order id and claw back exactly that. At minimum, log when a refund's derived qty differs from the matching grant, and confirm the refund payload's quantity location against the Polar sandbox.

## 4. `subscriptionWriteIsStale` disables itself when the incoming period anchor is missing — a reordered null-period `past_due` can drop a live `active` to Free
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: edge-case-gap
- **File**: `app/_lib/billing/reduce.ts:63` (`if (!incomingPeriodStart || !storedPeriodStart) return false;`)
- **Scenario**: Stored state is `active`, `sub_1`, period June→July. A reordered/stale `subscription.updated` for the same `sub_1` arrives late with `status=past_due` and `periodStart=null`/`periodEnd=null`. `subscriptionWriteIsStale` returns `false` (can't prove staleness without an anchor) → the write applies → `upsertBillingState` overwrites status to `past_due` with null period. Then `entitledPlan` (line 47-48, `past_due` fail-closed on an unparseable end) returns **Free**.
- **Root cause**: The staleness guard is defined only in terms of the period anchor, and treats a missing anchor as "apply." The tombstone/`setForRevokedSubscriptionIsStale` guard only covers the revoked-then-active reorder, not an active→past_due downgrade reorder. So a stale downgrade with no period bypasses the guard and combines with the fail-closed null-end branch to strip a paying customer.
- **Impact**: A paying customer is downgraded to Free mid-period by an out-of-order or malformed Polar delivery — the precise "Polar does not guarantee ordered delivery" failure these guards exist to stop, in a case they don't cover.
- **Fix sketch**: When an incoming same-subscription write carries no parseable period anchor, prefer to *retain* the stored period rather than nulling it (don't overwrite `current_period_*` with null on a same-sub update), or treat a null-anchor downgrade against a stored `active` for the same sub id as non-authoritative. That keeps `entitledPlan`'s grace math anchored to the last known-good period.

## 5. `meterGate`'s overrun safety is an unenforced multi-call-site contract
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: unenforceable-invariant
- **File**: `app/_lib/billing/enforce.ts:50` (the `inFlight` / `minUnits` contract prose)
- **Scenario**: Correct enforcement depends on every caller (a) passing a `minUnits` equal to the *worst-case* debit, not the typical one, and (b) leaving no `await` between counting in-flight reservations and inserting the reservation row. Both obligations live only in the docstring, spread across four routes (analyze, interview create/complete, two devcase routes). A future caller that passes the default `minUnits: 1` for the interview path (which can debit up to `maxBillableInterviewMin` = 2× booked) or slips an `await` before the insert silently reopens the cap overrun.
- **Root cause**: The invariant is expressed as prose, not enforced by the type or the function. `entitlements.ts:174-180` already acknowledges a residual gate→debit window as a follow-up, so even the intended happy path has a known hole.
- **Impact**: Latent, easy-to-reintroduce quota overrun / un-funded overage on the most expensive meter — no compile-time or runtime signal when a caller gets it wrong.
- **Fix sketch**: Fold the reserve into a single helper that does count-then-insert atomically (returning the verdict) so callers can't interleave an `await`, and require an explicit `minUnits` (no `?? 1` default) for metered actions whose debit is variable, so forgetting the worst-case value is a type error rather than a silent underestimate.
