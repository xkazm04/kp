# Payment gate — billing abstraction + Polar

> **Status (2026-06-11):** backend shipped. Live: `app/_lib/billing/` (plan
> catalog, gateway interface, standard-webhooks verification, pure reducer,
> entitlement math, webhook ingest), `billing_*` tables, Polar gateway (REST),
> and the API routes below. Outstanding: enforcement wiring at the LLM/interview
> route boundaries, a pricing/billing UI surface, and the sandbox checklist.

## Design

Pricing model (see memory/pricing-design and the landing page): Free / Starter
240 Kč ≈ $10 / Growth 480 Kč ≈ $20 / BYOM 120 Kč ≈ $5, metered in **AI
candidates, case designs, interview minutes** — never tokens — plus one-time
**minute packs** (100 min / 790 Kč) on any tier. (Starter/Growth were tuned down
from 490/1 190 Kč to $10/$20 on 2026-07-05; CZK is the primary display currency
at the app's implied ~24 Kč/$ rate.) Polar is the Merchant of Record (EU VAT is
theirs); we chose it over Paddle for native usage meters/credits, token-based
headless management, and no seller-approval friction at zero users.

**Enterprise** is a fifth, **contact-sales** tier (`plans.ts`, `contactSales:
true`): custom-priced, unlimited meters, granted per signed contract — never sold
through self-serve Polar checkout (the checkout route rejects it with a "talk to
sales" 400, and `isSelfServePlan()` gates it out everywhere). In-product it shows
in the Billing tab and the landing pricing band as a "Custom" price with a "Talk
to sales" mailto (`app/_lib/sales-contact.ts`, `NEXT_PUBLIC_SALES_EMAIL`). What it
takes to actually deliver that tier to a corporate buyer — SOC 2, enterprise SSO,
audit expansion, brand customization, a licensed self-host option, GDPR/DPA — is
the sequenced backlog in **docs/ENTERPRISE_READINESS.md**.

**The hedge:** everything Polar-specific lives in ONE file (`polar.ts`) behind
`BillingGateway` (`gateway.ts`): `createCheckout`, `createPortalSession`,
`verifyWebhook → BillingEvent`, `productMap`. A later Paddle migration (past
~$5–10k MRR, if ever) means implementing that interface — routes, reducer,
tables, and entitlement math stay untouched. The gateway talks Polar's REST API
directly with `fetch` (no vendor SDK dependency); webhook signatures are
verified in-house (`webhook-verify.ts`, the Standard Webhooks scheme).

```
checkout:   POST /api/billing/checkout {plan|pack} → gateway → provider URL (redirect)
state sync: provider → POST /api/billing/webhook
              verify signature → billing_events idempotency gate →
              reduce (pure, reduce.ts) → apply (sync.ts) → billing_state / billing_credits
read:       GET /api/billing → entitled plan + per-meter {limit, used, credits, remaining}
manage:     POST /api/billing/portal → provider customer-portal URL
```

**Money state is only ever written by the webhook path** — never trusted from
the client, never inferred from a checkout redirect.

## Entitlement semantics (entitlements.ts)

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
- **Enforcement is wired (2026-06-12, enforce.ts):** hard 402 gates (code
  `quota_exceeded`) where new metered work is created — `/api/analyze`
  (debits 1 `ai_candidates`), `/api/devcase/lifecycle` + `…/redesign` (debit
  `case_designs`), `/api/interview/create` (gate only; the debit is wall-time
  minutes at `/api/interview/complete`, completed calls only, clamped to 2×
  the booked length), and `/api/jobs/[id]/publish` (the active-jobs cap;
  seeded corpus jobs don't count). Degrade paths: reasoning-run and
  automation-run append `--no-llm` past the allowance — deterministic
  templates, never cached, upgrade when allowance returns.

## Idempotency (two layers)

1. `billing_events.id` = provider event id — a redelivered webhook is recorded
   and skipped.
2. `billing_credits.provider_ref` UNIQUE = order id — the same pack order
   arriving under a different event id still grants exactly once.

## Polar sandbox checklist (before any real charge)

> **Shortcut:** with `POLAR_ACCESS_TOKEN` + `POLAR_SERVER` in `.env`, steps 2
> and 4 are one command — `npm run polar:setup -- --tunnel
> https://<your>.trycloudflare.com`. Idempotent: verifies the product ids AND
> reconciles each product's live price against the catalog (warning loudly on
> drift), creates the missing minute pack, and creates the webhook endpoint
> (writing its secret to `.env`) or re-points the existing endpoint's URL at the
> new tunnel (secret unchanged). Run once per dev session after starting the
> tunnel; restart the dev server afterwards (Next reloads `.env` on change).

1. Create a sandbox org at sandbox.polar.sh → Organization Access Token →
   `POLAR_ACCESS_TOKEN`, `POLAR_SERVER=sandbox` in `.env`.
2. Create 4 products: Starter / Growth / BYOM (monthly subscriptions) and the
   100-minute pack (one-time). Paste ids into `POLAR_PRODUCT_*`.
3. Get a public URL for the local webhook endpoint. **On Windows** the Polar
   CLI installer is unsupported (Unix-only install.sh; no npm/Windows build as
   of 2026-06) — use a cloudflared quick tunnel instead (verified working,
   incl. ARM64):

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

## Not in scope yet

- Enforcement wiring at product routes (the `meterAllowance` /
  `recordMeterUsage` calls) + the over-quota UX (deterministic-mode banner with
  an upgrade prompt).
- Billing UI (plan card + usage bars + checkout buttons; the landing pricing
  section links here eventually).
- Multi-tenancy: `billing_state` is single-workspace (`id='workspace'`),
  matching the rest of the app; a tenant model adds a workspace key to the
  billing tables.
- BYOM tier enforcement (key-presence checks gating the unlimited meters).
