# Billing — payment gate + Polar

Status: backend shipped and enforcement wired. Outstanding: a richer pricing/
billing UI surface and org-level (seat-based) billing (tracked in
`docs/product/enterprise-readiness.md` §8 / E6).

## Entry points

- **Settings → Billing** (`app/features/settings/billing/BillingTab.tsx`) — plan
  card, usage meters, upgrade/checkout, portal link.
- Landing pricing band (`app/landing/spark/...`) links into checkout.

## Pricing model

Free / Starter 240 Kč ≈ $10 / Growth 480 Kč ≈ $20 / BYOM 120 Kč ≈ $5
(`app/_lib/billing/plans.ts`), metered in **AI candidates, case designs, interview
minutes** — never tokens — plus one-time **minute packs** (100 min / 790 Kč) on
any tier. CZK is the primary display currency at the app's implied ~24 Kč/$ rate.

**Enterprise** is a fifth, **contact-sales** tier (`plans.ts`, `contactSales: true`):
custom-priced, unlimited meters, granted per signed contract — never sold through
self-serve Polar checkout (the checkout route rejects it with a "talk to sales" 400,
and `isSelfServePlan()` gates it out everywhere). It shows in the Billing tab and the
landing pricing band as a "Custom" price with a "Talk to sales" mailto
(`app/_lib/sales-contact.ts`, `NEXT_PUBLIC_SALES_EMAIL`). What it takes to actually
deliver that tier to a corporate buyer is the sequenced backlog in
`docs/product/enterprise-readiness.md`.

Polar is the Merchant of Record (EU VAT is theirs) — chosen over Paddle for native
usage meters/credits, token-based headless management, and no seller-approval
friction at zero users.

## Surface

| Layer | File(s) | Notes |
|---|---|---|
| Plan catalog | `app/_lib/billing/plans.ts` | 5 plans + 1 pack; `isSelfServePlan()`. |
| Gateway interface | `app/_lib/billing/gateway.ts` | `BillingGateway`: `createCheckout`, `createPortalSession`, `verifyWebhook → BillingEvent`, `productMap`. |
| Polar implementation | `app/_lib/billing/polar.ts` | Everything Polar-specific lives in this ONE file, behind the gateway. Talks Polar's REST API directly with `fetch` — no vendor SDK dependency. |
| Webhook signature | `app/_lib/billing/webhook-verify.ts` | Standard Webhooks scheme, verified in-house. |
| Pure reducer | `app/_lib/billing/reduce.ts` | Payload normalization + the state-transition decision table. |
| Apply / entitlements | `app/_lib/billing/sync.ts`, `app/_lib/billing/entitlements.ts` | Applies reduced events to `billing_state`/`billing_credits`; computes entitled plan + meter allowance. |
| Enforcement | `app/_lib/billing/enforce.ts` | Hard 402 gates (`quota_exceeded`) at metered-work creation points. |
| DB | `app/_lib/db/billing.ts` | `billing_state`, `billing_events`, `billing_credits`, `billing_usage`, `billing_alerts` — all **org-keyed** (`org_id`, org-plan Phase 3 data layer): one subscription + ledger per org, shared across its teams. Accessors default to the seeded org, so single-org deployments read the exact rows they always did. `billingOrgForWorkspace` (entitlements.ts) maps the routes' existing `workspace` seam to its org (unknown/demo scopes fail closed to an empty scope); the webhook attributes an event via checkout metadata (`kpOrgId`) → stored subscription/customer → default org (`resolveBillingOrg`, sync.ts). Pinned by `app/_lib/db/billing-tenancy.test.ts`. |
| Routes | `app/api/billing/route.ts`, `checkout/route.ts`, `webhook/route.ts`, `portal/route.ts` (see below) | |
| UI — plan | `app/features/settings/billing/BillingTab.tsx`, `BillingCurrentPlanPanel.tsx`, `BillingPlanCatalog.tsx`, `BillingStatusBanners.tsx` | |
| UI — usage & cost | `app/features/settings/billing/spend/**` | Consolidated spend section (see below); moved here from the Models tab. |

```
checkout:   POST /api/billing/checkout {plan|pack} → gateway → provider URL (redirect)
state sync: provider → POST /api/billing/webhook
              verify signature → billing_events idempotency gate →
              reduce (pure, reduce.ts) → apply (sync.ts) → billing_state / billing_credits
read:       GET /api/billing → entitled plan + per-meter {limit, used, credits, remaining}
manage:     POST /api/billing/portal → provider customer-portal URL
```

**Money state is only ever written by the webhook path** — never trusted from the
client, never inferred from a checkout redirect.

### The Usage & cost section (`app/features/settings/billing/spend/`)

The billing tab renders the plan card, then **one** consolidated spend section,
then the plan catalog. The section combines three reads that used to live on two
different tabs:

| Source | Contribution |
|---|---|
| the tab's `GET /api/billing` payload | this period's plan meters: allowance, remaining, pack credits |
| `GET /api/llm/usage` | the `llm_usage` ledger folded per use case over 30 days (`spendUsageFold.ts`, unit-tested) |
| `GET /api/ops` | engine availability, run queue, automation clock, 7-day analyze rollups, comms/schedule failure counters |

`useSpendData.ts` owns both fetches, so the section has **one** loading state and
**one** failure state. The ledger read is the failure that matters; a dead
`/api/ops` drops the engine lines rather than erroring the section.

Why it moved: "how much allowance is left" and "what did the AI actually cost"
are one question, and they were being answered by a meters card here and a Usage
panel on the Models tab that never referenced each other. Metered spend belongs
next to the plan that meters it. The AI-layer plumbing those numbers come from is
still documented in
[../../architecture/llm-provider-layer.md](../../architecture/llm-provider-layer.md).

**The layout is an attribution chart** (`BillingSpendPanel.tsx`): one
proportional bar per use case, widest first, with its share of total spend, so
"role intake costs four times what JD ingest does" is a glance rather than a
calculation. The plan allowance is a narrow left rail (an entitlement constrains
the chart; it is not a peer of it) and engine health is a footer line. Chosen
over two rejected directions — a "Statement" (one headline figure, then ruled
bands of arithmetic) and a "Cockpit" (a uniform gauge grid treating a plan
allowance and a cache-hit rate as the same instrument).

`SpendEngineFacts` renders the three failure counters (`deadLetters7d`,
`reconcileFailures`, `noSlotStalls`) **only when non-zero**. This footer is the
only screen in the app carrying the latter two, so hiding them unconditionally
would delete an alarm rather than quiet it.

Known gap from the move: the per-use-case **token columns** (in / out / cached)
and the 7-day **cache-hit rate**, **average analysis duration** and **stage
timings** that the old Models panel + System card showed are not on this layout.
They are still in `GET /api/llm/usage` and `GET /api/ops`; folding the useful
ones into the footer is a small additive change if they turn out to be missed.

## Entitlement semantics (`entitlements.ts`)

- Entitled plan: `active`/`trialing` → plan; `past_due` → plan (the MoR runs
  dunning; grace beats cutting a paying customer mid-retry); `canceled` → plan
  until `current_period_end`; otherwise free.
- Each meter has a monthly included allowance (`billing_usage`, UTC `YYYY-MM`)
  plus a prepaid credit balance (`billing_credits` ledger). Credits are
  consumed only after the month's included allowance, one negative ledger row
  per unit, so balances survive month boundaries without double counting.
- **Degrade, not block:** call sites ask `meterAllowance(meter)` before
  spending and switch to their deterministic fallbacks when exhausted — the
  same paths that run when an LLM provider is down. Reads never hard-fail.
- **Enforcement is wired** (`enforce.ts`): hard 402 gates where new metered
  work is created — `/api/analyze` (debits 1 `ai_candidates`),
  `/api/devcase/lifecycle` + `…/redesign` (debit `case_designs`),
  `/api/interview/create` (gate only; the debit is wall-time minutes at
  `/api/interview/complete`, completed calls only, clamped to 2× the booked
  length), and `/api/jobs/[id]/publish` (the active-jobs cap; seeded corpus
  jobs don't count). Degrade paths: reasoning-run and automation-run append
  `--no-llm` past the allowance — deterministic templates, never cached,
  upgrade when allowance returns.

## Idempotency (two layers)

1. `billing_events.id` = provider event id — a redelivered webhook is recorded
   and skipped.
2. `billing_credits.provider_ref` UNIQUE = order id — the same pack order
   arriving under a different event id still grants exactly once.

## Keyless / degraded behavior

Leave `POLAR_ACCESS_TOKEN` unset and every billing route answers **503** — the
app runs fully unbilled (the local-first default). This is the same
degrade-not-block posture as the LLM layer. Self-hosted deployments typically
leave billing off entirely (`docs/architecture/self-hosting.md` §6).

## Polar sandbox checklist (before any real charge)

> **Shortcut:** with `POLAR_ACCESS_TOKEN` + `POLAR_SERVER` in `.env`, steps 2
> and 4 are one command — `npm run polar:setup -- --tunnel
> https://<your>.trycloudflare.com` (`scripts/polar-setup.mjs`). Idempotent:
> verifies the product ids AND reconciles each product's live price against the
> catalog (warning loudly on drift), creates the missing minute pack, and
> creates the webhook endpoint (writing its secret to `.env`) or re-points the
> existing endpoint's URL at the new tunnel (secret unchanged). Run once per
> dev session after starting the tunnel; restart the dev server afterwards
> (Next reloads `.env` on change).

1. Create a sandbox org at sandbox.polar.sh → Organization Access Token →
   `POLAR_ACCESS_TOKEN`, `POLAR_SERVER=sandbox` in `.env`.
2. Create 4 products: Starter / Growth / BYOM (monthly subscriptions) and the
   100-minute pack (one-time). Paste ids into `POLAR_PRODUCT_*`.
3. Get a public URL for the local webhook endpoint. **On Windows** the Polar
   CLI installer is unsupported (Unix-only install.sh; no npm/Windows build) —
   use a cloudflared quick tunnel instead:

   ```powershell
   winget install --id Cloudflare.cloudflared
   cloudflared tunnel --url http://localhost:3001   # match your dev port!
   ```

   It prints a `https://<random>.trycloudflare.com` URL (free, no account; the
   hostname CHANGES on every start — update the endpoint URL in Polar each dev
   session, or create a named tunnel on a free Cloudflare account for a stable
   one). On macOS/Linux, Polar's own `polar listen http://localhost:3000/api/billing/webhook`
   does the same job.
4. Register the webhook endpoint in Polar (Settings → Webhooks → Add
   Endpoint): URL = `<tunnel>/api/billing/webhook`, format **Raw**, generate a
   secret → `POLAR_WEBHOOK_SECRET` in `.env` → restart the dev server.
   Subscribe: `subscription.updated` (the catch-all covering active/canceled/
   uncanceled/past_due/revoked) plus `subscription.created`, and
   **`order.paid`** — NOT `order.created`, which fires before payment capture
   (the reducer ignores unpaid pack orders by design).
   Sanity probes: an unsigned `POST <tunnel>/api/billing/webhook` answers
   503 + "POLAR_WEBHOOK_SECRET is not set" before the secret is configured,
   and 400 + "missing webhook-…" after — both prove the path end to end.
5. Run a test checkout per product (`POST /api/billing/checkout`), pay with
   Stripe's test card `4242 4242 4242 4242` (any future expiry/CVC), and
   verify: `GET /api/billing` shows the plan/credits; `billing_events` has the
   deliveries; the portal route returns a URL.
6. Field-mapping caveat: `mapPolarEvent` reads Polar payloads defensively
   (`product_id`/`product.id`, `customer_id`/`customer.id`, period fields).
   Confirm against the sandbox deliveries in `billing_events.payload_json` and
   tighten if Polar's shapes differ.

## Tests

- `app/_lib/billing/webhook-verify.test.ts` — signature scheme (tamper, stale
  timestamp, key rotation, constant-time compare).
- `app/_lib/billing/reduce.test.ts` — payload normalization + the reducer's
  decision table.
- `app/_lib/billing-gate.test.ts` — the whole stack against a throwaway SQLite
  file via a fake gateway: free limits, allowance debits, pack grants with
  both idempotency layers, plan upgrade via webhook, revoke-to-free, the
  canceled-until-period-end rule.
- `app/_lib/billing/price-reconcile.test.ts` — the price-drift check used by
  `polar-setup.mjs`.

## Known gaps

- Billing UI beyond the current plan card + usage bars (richer upgrade flows,
  usage-exhausted banners) — the landing pricing section links here eventually.
- Org billing (org-plan Phase 3 / enterprise-readiness E6): the **data layer is
  done** — `org_id` on every billing table, org-keyed reducer/entitlement
  lookups, checkout-metadata webhook attribution, per-org meter isolation
  (`billing-tenancy.test.ts`). Still open from E6: **seat quantity** in checkout
  + webhook, seat enforcement vs. memberships, per-team metering breakdowns, and
  `llm_usage` attribution. The metered-work debit call sites now thread the
  requesting workspace (analyze, interview complete, dev-case lifecycle/redesign);
  background/legacy paths without a tenant default to the seeded org.
- BYOM tier enforcement (key-presence checks gating the unlimited meters) not
  built.
