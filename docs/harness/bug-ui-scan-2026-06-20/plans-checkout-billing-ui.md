# Plans, Checkout & Billing UI — UI Perfectionist scan

> Context: The Billing tab where users view their plan, start checkout, and open the customer portal.
> Files reviewed: 8 of 6 (6 manifest files + 2 supporting: billing/index.ts, entitlements.ts, recipes.ts, en.json)
> Total: 7 findings — Critical: 0, High: 2, Medium: 3, Low: 2

## 1. Checkout-success banner can claim the user is on the WRONG (old) plan

- **Severity**: High
- **Category**: misleading-feedback / revenue-trust
- **File**: `app/features/sub_billing/BillingTab.tsx:198-211,277`
- **Scenario**: A recruiter pays for Growth and is redirected back to `/?tab=billing&billing=success`. The post-return effect polls `load()` at 2s and 5s, then unconditionally flips `checkout` to `"done"` at 5500ms. If the Polar webhook hasn't landed the new entitlement within ~5.5s (network lag, provider queue, retry), `data.plan` is still the OLD plan.
- **Root cause**: The "done" transition is a fixed timer (`setTimeout(() => setCheckout("done"), 5500)`) decoupled from whether the entitlement actually changed. The banner then renders `t("checkoutDone", { plan: data?.plan.name ?? "" })`.
- **Impact**: A paying customer sees a green success banner reading "You're all set. Your plan is now **Free**" (or their pre-purchase plan), or "…is now ." when `data` is somehow null. After paying, that reads as money-taken-but-nothing-changed — the single highest-trust moment in the product undermined.
- **Fix sketch**: Only flip to `"done"` once the polled overview reflects a changed plan/status (compare `data.plan.id`/`status` against the pre-checkout snapshot). If it hasn't settled after the poll window, keep showing "confirming…" with a manual "Refresh" affordance rather than asserting a concrete (stale) plan name. Never render `checkoutDone` with an empty `{plan}`.

## 2. Free-tier "Interview minutes" meter renders an invalid progressbar (aria-valuemax=0)

- **Severity**: High
- **Category**: a11y
- **File**: `app/features/sub_billing/BillingTab.tsx:64-75` (data: `app/_lib/billing/plans.ts:34`)
- **Scenario**: On the Free plan, `interview_minutes` has `limit: 0` (a real number, not `null`). `billingOverview()` emits it as a meter, and `MeterRow` renders the progress bar whenever `limit !== null` — so `limit === 0` still draws a bar with `role="progressbar" aria-valuemin={0} aria-valuemax={0} aria-valuenow={0}`.
- **Root cause**: The "no bar" branch keys on `limit === null` (the unlimited/BYOM case) but never on `limit === 0` (the "this tier includes none of this" case). ARIA requires `aria-valuemax > aria-valuemin`; a 0/0 progressbar is invalid and announced incoherently ("0 percent" / no usable value) by screen readers.
- **Impact**: Every Free-tier (and BYOM `interview_minutes: 0`) user — the largest cohort — gets a broken, meaningless bar and an invalid ARIA node. Visually it's an always-empty rail that implies "0% used" rather than "not included on this plan."
- **Fix sketch**: Treat `limit === 0` like `limit === null` for the bar: skip the `<div role="progressbar">` and instead show a "Not included — top up with a pack" hint (the minutes pack is sold on every tier). Add `limit === 0 ?` to the early-return alongside the `null` check.

## 3. Disabled plan/pack buttons in local-dev give no per-control explanation

- **Severity**: Medium
- **Category**: affordance / disabled-state
- **File**: `app/features/sub_billing/BillingTab.tsx:141-150,432-439`
- **Scenario**: When `!data.configured` (Polar env absent — local dev), every "Switch to this plan" and "Buy pack" button is `disabled` but otherwise looks the same. There is one global `notConfigured` banner at the top, but a user scrolling the catalog and clicking a greyed button gets no feedback at the point of interaction.
- **Root cause**: The reason for the disabled state lives only in a far-away banner; the buttons carry no `title`/`aria-describedby`/tooltip tying the dead control to its cause. Disabled buttons also can't receive focus, so keyboard/SR users get no explanation at all.
- **Impact**: Confusing dead affordance — the most common "why can't I click this?" UX papercut, worse for assistive-tech users who never see the top banner in context.
- **Fix sketch**: Add `title={!configured ? t("notConfigured") : undefined}` (and an `aria-describedby` pointing at the banner id) to the checkout buttons, or render the CTA as an explanatory non-button when unconfigured.

## 4. Pack "Buy" button has no error-clearing / retry parity with plan cards

- **Severity**: Medium
- **Category**: error-state / inconsistency
- **File**: `app/features/sub_billing/BillingTab.tsx:432-445,224-239`
- **Scenario**: A checkout for the minutes pack fails (502 from `/api/billing/checkout`). `startCheckout` sets `purchase = { key: "minutes_100", error }`. The error renders, but the guard `if (purchase && purchase.error === null) return;` only blocks a *successful* in-flight purchase — once an error is set, a second click is allowed, which is fine — yet the button label logic (`purchase?.key === "minutes_100" && purchase.error === null ? redirecting : buy`) means after an error the button silently reverts to "Buy pack" with the red error still showing, and nothing distinguishes "retry" from "first try."
- **Root cause**: Error and busy state share one `purchase` object keyed by id; the pack block re-implements the plan card's busy/error rendering by hand instead of reusing `PlanCard`'s consolidated treatment, so the two surfaces drift.
- **Impact**: Inconsistent recovery affordance between plans and the pack; a failed pack purchase looks like a fresh, un-attempted button sitting above a stale error line.
- **Fix sketch**: Extract a shared `CheckoutButton` (busy label + inline `role="alert"` error + disabled logic) used by both `PlanCard` and the pack row, so error/retry/redirect states are identical everywhere.

## 5. Checkout button can hang on "Redirecting…" forever if navigation never completes

- **Severity**: Medium
- **Category**: loading-state / stuck-UI
- **File**: `app/features/sub_billing/BillingTab.tsx:224-239`
- **Scenario**: On a successful checkout-session create, the code calls `window.location.assign(p.url)` and intentionally leaves `busy` standing. If that navigation is slow, interrupted (user hits back), or the returned `url` is reachable-but-stalls, the button stays "Redirecting…" indefinitely with the whole catalog frozen (the `purchase.error === null` guard blocks any further click).
- **Root cause**: "Busy is permanent because we're navigating away" assumes navigation always succeeds promptly; there's no watchdog and no recovery if it doesn't.
- **Impact**: A wedged, un-retryable checkout button — the user's only escape is a full page reload, on the revenue-critical path.
- **Fix sketch**: Set a fallback timer (e.g. 8–10s) after `assign()` that, if the page is still alive, clears `purchase` and surfaces a "Taking longer than expected — try again" message; or render an inline "open checkout" link as a manual fallback.

## 6. Period-end date renders even for non-recurring / canceled-without-end states

- **Severity**: Low
- **Category**: stale-data / clarity
- **File**: `app/features/sub_billing/BillingTab.tsx:339-343` (source: `app/_lib/billing/entitlements.ts:96-97`)
- **Scenario**: `periodEnd` comes straight from `state.currentPeriodEnd`. For a `canceled` subscription whose period has already lapsed, `entitledPlan` downgrades the user to Free, but `billingOverview` still returns the old `currentPeriodEnd`, so the UI can show "Current period ends <a past date>" under a Free plan badge.
- **Root cause**: The displayed plan (downgraded to Free post-lapse) and the raw `periodEnd` are computed independently; the UI doesn't reconcile a past date against the now-Free entitlement.
- **Impact**: A confusing/contradictory line ("Free plan … period ends <last month>"). Minor but erodes trust on the billing surface.
- **Fix sketch**: Hide `periodEnd` when the resolved plan is `free`, or when the parsed date is in the past; better, have `billingOverview` null out `periodEnd` once it no longer entitles anything.

## 7. Current-plan price line concatenates currency + status into one unstructured paragraph

- **Severity**: Low
- **Category**: visual-hierarchy / component-extraction
- **File**: `app/features/sub_billing/BillingTab.tsx:321-338` vs `116-128`
- **Scenario**: The "current plan" header re-implements the exact CZK-primary / "≈ USD · per month" price formatting that `PlanCard` already does (lines 116-128), but inline as a single `<p>` with nested `<span>`s, producing slightly different spacing/structure than the card.
- **Root cause**: Price rendering (free vs paid, CZK + approx-USD + per-month) is duplicated in two places with copy-pasted `format.number(...currency...)` calls instead of a shared `<PlanPrice plan={...} />`.
- **Impact**: Drift risk — a future price-format tweak (e.g. showing decimals, or a different USD label) must be made in two spots and will visibly diverge if missed. No user-facing break today.
- **Fix sketch**: Extract a `PlanPrice` component (handles `priceCzk === 0` → free, else CZK + `approxUsd` + `perMonth`) and use it in both the current-plan header and `PlanCard`.
