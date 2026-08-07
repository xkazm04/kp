# Plans, Checkout & Billing UI — bug-hunter + ui-perfectionist scan

> Context: The Billing tab where users view their plan, start checkout, and open the customer portal.
> Files reviewed: 6 of 6 (+8 supporting billing modules: gateway/polar/index/entitlements/sync/reduce/webhook route/public-base-url)
> Total: 5

## 1. Checkout route has no server-side "already subscribed" guard — double-charge is prevented in the client only

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: `app/api/billing/checkout/route.ts:13-48` (client-only guard at `app/features/sub_billing/BillingTab.tsx:448-451`)
- **Scenario**: A recruiter opens the Billing tab while on Free (the client caches `data.plan.id === "free"`, so `changeVia = "checkout"` and every plan shows a "Choose" button). In another tab/device they complete a Starter checkout; the webhook lands Starter. The first tab never re-fetches (BillingTab only `load()`s on mount + on checkout-return), so it still shows checkout buttons. They click "Choose Growth" → `POST /api/billing/checkout {plan:"growth"}` → the route mints a **second** subscription. Same result from any crafted direct POST.
- **Root cause**: The invariant "an existing paid subscriber must change plans via the PORTAL, never a fresh checkout" is enforced *only* in `BillingTab`'s `changeVia`. The checkout route validates the plan id and self-serve-ness but never reads `getBillingState()` — it trusts the client made the right checkout-vs-portal choice. A trust-boundary decision lives outside the trust boundary.
- **Impact**: Parallel active subscriptions → the customer is billed for both every month. Real, recurring money error.
- **Fix sketch**: In the checkout route, before creating a plan checkout, read `getBillingState()`/`entitledPlan()`; if an active/trialing/past_due subscription exists, return 409 "You already have a plan — manage it from the portal." Make the portal the only server-accepted path to a plan *change*, so a stale client or a raw POST can't mint a parallel sub.

## 2. [STILL-OPEN] Checkout-success banner asserts "your plan is now X" on a fixed 5.5s timer, decoupled from the entitlement actually landing

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/features/sub_billing/BillingTab.tsx:251-262, 326-329`
- **Scenario**: After paying, the provider returns to `/?tab=billing&billing=success`. The effect polls `load()` at 2s/5s, then **unconditionally** `setCheckoutConfirmed(true)` at 5500ms. If the Polar webhook hasn't settled the new plan by then (provider queue, retry, `SQLITE_BUSY` on the webhook tx), `data.plan` is still the OLD plan when the banner flips to "done".
- **Root cause**: The "done" transition is a wall-clock timer, not a function of whether the polled overview changed. The banner then renders `t("checkoutDone", { plan: data?.plan.name ?? "" })` — success theater asserting a concrete plan it never verified. Still present exactly as the 2026-06-20 report (#1) described; it still matters because it is the single highest-trust moment in the product.
- **Impact**: A paying customer sees a green "You're all set — your plan is now **Free**" (their pre-purchase plan), or "…is now ." when `data` is null. Reads as money-taken-nothing-changed.
- **Fix sketch**: Snapshot `plan.id`/`status` before redirect; only flip to "done" once a poll reflects a *changed* entitlement. If the poll window lapses unsettled, keep "confirming…" with a manual "Refresh" — never assert a concrete/empty plan name.

## 3. "Manage subscription" opens the portal with `window.open` after an `await` — a popup-blocked click fails silently

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/features/sub_billing/BillingTab.tsx:292-310` (the `window.open` at :304)
- **Scenario**: A subscriber clicks "Manage subscription". `openPortal` `await`s `POST /api/billing/portal`, then calls `window.open(p.url, "_blank", ...)`. Because the open happens *after* the network await, the user-activation token has often expired, so the browser (Safari/Firefox strict, or any popup blocker) blocks it and `window.open` returns `null`. The code never checks the return value; `finally` clears `portalBusy` and no `portalNote` is set.
- **Root cause**: The success path assumes `window.open` after an async gap always yields a window. Checkout correctly uses same-tab `window.location.assign` (never blocked); the portal path diverged to a blockable new-tab open with no null-check.
- **Impact**: Clicking Manage does nothing, with zero feedback — the customer cannot reach the only surface to cancel/downgrade/see invoices. Silent dead-end on the billing-management path.
- **Fix sketch**: Capture `const w = window.open(...)`; if `!w`, surface a `portalNote` with the URL as a fallback link (`role="alert"`), or pre-open a blank tab synchronously on click and set its `location` after the fetch resolves.

## 4. Catalog prices (CZK/USD) are hardcoded and decoupled from Polar's charged amounts, with no reconciliation — display can drift from the charge

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: `app/_lib/billing/plans.ts:5-9, 42-68`; `scripts/polar-setup.mjs:100-127`
- **Scenario**: `plans.ts` renders `priceCzk: 240` (Starter), `480` (Growth), etc. as the *primary* displayed currency, while the amount actually charged lives on the Polar product object. `polar-setup.mjs` only *checks that the subscription product ids exist* (`POLAR_PRODUCT_*`) — it never creates or verifies their prices — and it creates the minute pack **USD-only** at `$34` while the UI shows `790 Kč` as the primary price. Any dashboard edit or currency mismatch on a Polar product makes the shown price diverge from the settled charge.
- **Root cause**: Two independent sources of truth for price (the TS catalog for display, the provider product for the charge) with no test/preflight tying them together; the "validate against sandbox" step is a manual checklist, not enforced.
- **Impact**: A customer sees one price on the plan card and is charged another at Polar — a money-trust break that surfaces only after a real charge.
- **Fix sketch**: Fetch each product's live price in the `GET /api/billing` overview (or a startup preflight) and assert it matches the catalog within a tolerance, warning loudly on drift; at minimum have `polar-setup.mjs` set/verify subscription-product prices (and price the pack in CZK too) instead of only checking id existence.

## 5. Current-plan header prices Enterprise as "Free" — it checks `priceCzk === 0` instead of `contactSales`

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: `app/features/sub_billing/BillingTab.tsx:372-389` (vs `PlanCard`'s correct `contactSales` handling at :127-133)
- **Scenario**: An Enterprise customer (entitled via a manual grant — `enterprise` has no self-serve product, so this is the only way `state.plan` becomes `"enterprise"`). The catalog `PlanCard` renders "Custom" because it branches on `plan.contactSales` first. But the **current-plan header** branches only on `data.plan.priceCzk === 0`, and Enterprise's `priceCzk` is a `0` sentinel — so the header renders `t("plans.priceFree")` ("Free") for the highest-paying customer.
- **Root cause**: The current-plan header duplicates the price logic but omits the `contactSales` guard that `PlanCard` has, so the `priceCzk === 0` sentinel (meant only for the Free tier) collides with the Enterprise sentinel.
- **Impact**: An Enterprise customer's billing page states their plan costs "Free" — a wrong, trust-eroding money display for the top-value account (rare: reachable only via a manual enterprise grant).
- **Fix sketch**: Extract a shared `<PlanPrice plan={...} />` (contactSales → "Custom"; priceCzk 0 → "Free"; else CZK + approx-USD) and use it in both the header and `PlanCard`, so the two can never diverge.
