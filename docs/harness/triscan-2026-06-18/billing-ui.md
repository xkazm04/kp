# Plans, Checkout & Billing UI — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 2 bug / 1 ui / 2 biz

## 1. Successful checkout returns to a silent page — no confirmation, no entitlement refresh
- **Lens**: 🚀 Business Visionary (primary) | 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Conversion / post-purchase UX
- **Value**: impact 9/10 · effort 3/10 · risk 2/10
- **File**: `app/api/billing/checkout/route.ts:35` (sets `/?billing=success`); nothing in `app/` ever reads it
- **Scenario**: A recruiter pays on Polar's hosted form and is redirected to `/?billing=success`. The home page ignores the param entirely. The Billing tab (mounted only on demand) cached its overview on first load, and entitlement lands asynchronously via the webhook anyway — so the user sees the OLD plan with no "Thanks, you're on Growth" moment, no toast, no refresh. It looks like the payment did nothing.
- **Root cause**: The `?billing=success` return URL is generated but consumed nowhere (verified: the only repo match is where it's set). `BillingTab` loads once in `useEffect` and never re-fetches; there is no success handler in the app shell.
- **Impact**: The highest-intent moment in the funnel (money just changed hands) produces doubt instead of delight — drives support tickets, refund requests, and double-checkout attempts. Directly suppresses realized revenue and trust.
- **Fix sketch**: On the landing/home shell, read `?billing=success` → show a success toast and strip the param. In `BillingTab`, when the param is present (or on window `focus`/`visibilitychange` after a checkout), re-`load()` the overview with a short poll/backoff so the new plan appears once the webhook settles; show a transient "Confirming your purchase…" state meanwhile.

## 2. Billing checkout/portal routes are fully public when KP_OPERATOR_PASSWORD is unset
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Auth / billing route exposure
- **Value**: impact 7/10 · effort 3/10 · risk 3/10
- **File**: `proxy.ts:37` (gate is `if (process.env.KP_OPERATOR_PASSWORD)`); `app/api/billing/checkout/route.ts:12`, `app/api/billing/portal/route.ts:12` (no own session check)
- **Scenario**: In any deploy where `KP_OPERATOR_PASSWORD` is not set (the documented "runs open" default, and the likely state of an early single-tenant prod), `proxy.ts` skips the auth gate for ALL routes. Anyone who can reach the host can `POST /api/billing/portal` and receive a live Polar customer-portal URL for the workspace's real customer — i.e. cancel the subscription, see invoices/PII, change payment details — and can spin up checkout sessions at will.
- **Root cause**: Auth is opt-in at the proxy layer only; the billing routes themselves do no session check and never resolve `currentWorkspace()` (unlike `analyses`/`profiles` routes which thread it). The portal mints a session from `getBillingState().providerCustomerId` with no caller identity check.
- **Impact**: Account-takeover-adjacent: unauthenticated subscription cancel + invoice/PII disclosure via the portal link. Latent today (single workspace, password often set in prod) but a sharp edge as soon as one deploy forgets the env var.
- **Fix sketch**: Defense in depth — call `requireSession()`/`currentWorkspace()` inside the checkout and portal handlers and 401 when absent, independent of the proxy opt-in. Document `KP_OPERATOR_PASSWORD` as required for any internet-reachable deploy; consider failing closed (gate on by default) for non-localhost hosts.

## 3. Plan-state is hardcoded single-workspace — billing entitlements ignore the session tenant
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Tenancy / plan-state desync (latent)
- **Value**: impact 7/10 · effort 6/10 · risk 5/10
- **File**: `app/_lib/db/billing.ts:19` (`const WORKSPACE = "workspace"`); `getBillingState()` takes no workspace arg; consumed by `entitlements.ts:91`, `enforce.ts:43`
- **Scenario**: Every other table (`analyses.ts`, `profiles.ts`) threads `workspaceId` from `currentWorkspace()`. Billing does not: `getBillingState`, `upsertBillingState`, `billingUsageFor`, `creditBalance` all read/write the literal row `id='workspace'`. The day a second workspace exists, all tenants share ONE plan, ONE usage counter, and ONE credit ledger — workspace B's CV runs decrement workspace A's allowance, and B sees A's plan/period/customer.
- **Root cause**: The billing store predates (and was not migrated into) the workspace tenancy seam. The webhook write path has no workspace dimension either, so even correct multi-tenant sessions can't disambiguate which customer an event belongs to.
- **Impact**: Cross-tenant entitlement and usage corruption, plus billing/PII bleed, the moment tenancy ships. High blast radius; flagged latent because there is one workspace today.
- **Fix sketch**: Add a `workspace_id` column to `billing_state`/`billing_usage`/`billing_credits` (migration), thread `workspaceId` through every accessor and the webhook reducer (map provider customer→workspace), and resolve it from `currentWorkspace()` in the routes. Until then, add a code comment + test asserting single-workspace assumption so it isn't silently broken.

## 4. `GET /api/billing` has no try/catch — a transient DB error renders a dead-end "couldn't load"
- **Lens**: 🐛 Bug Hunter (primary) | 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Error handling / resilience
- **Value**: impact 5/10 · effort 2/10 · risk 1/10
- **File**: `app/api/billing/route.ts:12`
- **Scenario**: `billingOverview()` runs several synchronous SQLite reads (`getBillingState`, `billingUsageFor`, `creditBalance`). Unlike `app/api/analyses/route.ts` (wrapped in try/catch → stable 500 message), this handler has none. A locked/transient DB throws, Next returns an unframed 500, and `BillingTab` shows only the generic `loadFailed` panel — the user can't tell a one-off blip from "billing is broken," and the retry button is the only recourse with no signal it'll help.
- **Root cause**: Missing error boundary in the route; the UI's single `loadFailed` flag also can't distinguish transient vs. persistent failure.
- **Impact**: Money/plan screen looks broken on any DB hiccup; raw stack/SQLite internals can leak in the unframed error. Inconsistent with the codebase's own error-handling convention.
- **Fix sketch**: Wrap the body in try/catch, `console.error` server-side, return `{ error: "Failed to load billing." }` with 500 (mirror `analyses`). Optionally have `BillingTab` auto-retry once with backoff before showing the manual panel.

## 5. No upgrade nudge at the quota wall — the highest-intent upsell moment is unsurfaced in Billing
- **Lens**: 🚀 Business Visionary (primary) | 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Monetization / upgrade prompt timing
- **Value**: impact 6/10 · effort 4/10 · risk 2/10
- **File**: `app/features/sub_billing/BillingTab.tsx:42` (`MeterRow` shows `depleted` but no CTA); `app/_lib/billing/enforce.ts:46` (gate already emits a `quota_exceeded` verdict + `upgrade` copy elsewhere)
- **Scenario**: When a meter is depleted, `MeterRow` renders a red "depleted" badge and stops — no path to the fix. The plan catalog is a separate block further down with generic "Switch" buttons; nothing connects "you're out of AI candidates" to "Growth gives you 400." The minute-pack top-up exists but is never surfaced beside the depleted `interview_minutes` meter. The enforcement layer already tells users to "upgrade or top up in Billing," then Billing doesn't close the loop.
- **Root cause**: The usage panel and the catalog are presentational siblings with no cross-link; depletion is shown as a dead-end status rather than a conversion trigger tied to the specific exhausted meter.
- **Impact**: Misses the single best-converting upsell moment (user is actively blocked, wants more) — leaves expansion revenue on the table and adds friction to the very action that monetizes.
- **Fix sketch**: In `MeterRow`, when `depleted`, render a context CTA — for `interview_minutes` a "Top up 100 min" button wired to the existing pack checkout; for `ai_candidates`/`case_designs` a "See plans that include more" link that scrolls to and highlights the recommended next tier. Reuse `startCheckout`; keep it disabled-with-reason when `!configured`.
