# Billing — payment gate + Polar

Status: backend shipped and enforcement wired, on an **outcome-priced** model.
Outstanding: a richer pricing/billing UI surface.

## Read this first: billing applies to the HOSTED product only

KP is open source (AGPL-3.0). **A self-hosted install is not metered at all** —
every meter below resolves unlimited and no gate ever fires.

The seam is `app/_lib/billing/mode.ts` + `meteringActive()` in
`billing/entitlements.ts`. A deployment is metered when either:

1. a **billing provider is configured** (`POLAR_ACCESS_TOKEN` — the hosted
   product), or
2. **this org already carries billing state** (it transacted at some point, so it
   is a customer even if the credential later went missing from a deploy).

Otherwise `resolvedLimit()` returns `null` for every meter before the plan is
consulted, including the two outcome meters that carry the headline price. Both the
read path (`meterOverview` → `meterGate`/`meterAllowance`) and the write path
(`recordMeterUsage`'s credit split) go through that ONE function, so the amount
gated and the amount debited can never diverge — `meter-attribution.test.ts` pins
the shape, `billing-selfhost.test.ts` pins the unmetered behaviour, and
`billing-gate.test.ts` sets `POLAR_ACCESS_TOKEN` to pin the metered one.

Why clause (2) exists: keying purely on the env var would rest the hosted product's
entire revenue gate on one variable surviving a deploy. With it, the failure mode of
a mis-set credential is "too generous to a brand-new org", never "billed a
self-hoster".

**`KP_OFFLINE=1` answers clause (1) NO, whatever the env holds.** An air-gapped
install (`docs/architecture/self-hosting.md` §7) cannot reach a Merchant of Record:
`polarGatewayFromEnv()` already returns null there and every billing route answers
503. `billingProviderConfigured()` now short-circuits on the same flag, so a leftover
`POLAR_ACCESS_TOKEN` in an offline `.env` can't say "commercial" while nothing can
actually be sold — which resolved the operator to `PLANS.free` and 402'd their SECOND
published role, pointing at a Billing panel that reports itself unconfigured. Only the
credential clause is short-circuited: clause (2) is untouched, so an org that has ever
transacted stays metered even if someone flips the flag on. Pinned by
`app/_lib/billing/mode.test.ts`.

**Usage is still RECORDED while unmetered.** Unmetered means never refused, not
never counted — a self-hoster's own analytics still wants the numbers.

### The BYOM tier is withdrawn from sale

BYOM sold "your model keys, our machinery" for 120 Kč, which is exactly what
self-hosting now gives away, unlimited and free. It carries `legacy: true` in
`plans.ts`: gone from the pricing page, gone from the Billing catalog, refused by
`isSelfServePlan`, and no longer provisioned by `scripts/polar-setup.mjs` — while
every existing subscriber keeps their limits, their portal and their webhook
mapping. Do not delete the row or the Polar product: that would drop paying
customers to free on the next entitlement read.

**There are no seats and never have been.** An earlier version of this line read
"org-level (seat-based) billing" as an outstanding item, and that phrasing was
routinely misread as a description of the present. Pricing has always been a flat
monthly subscription per ORG with metered allowances — nothing is priced per user,
per member or per quantity. Per-seat pricing is not planned: the meters below price
outcomes instead.

## Entry points

- **Settings → Billing** (`app/features/settings/billing/BillingTab.tsx`) — plan
  card, usage meters, upgrade/checkout, portal link.
- Landing pricing band (`app/landing/spark/...`) links into checkout.

## Pricing model

Free / Starter 240 Kč ≈ $10 / Growth 480 Kč ≈ $20 / BYOM 120 Kč ≈ $5
(`app/_lib/billing/plans.ts`), plus one-time **minute packs** (100 min / 790 Kč) on
any tier. CZK is the primary display currency at the app's implied ~24 Kč/$ rate.

**The customer pays for outcomes.** Two meters carry the headline price:

| Meter | Debited when | Gated? |
| --- | --- | --- |
| `job_posts` | a role is published — `published_at` is `COALESCE`-stamped, so **once per job ever**; closing and reopening never re-charges | **Yes**, 402 in the publish transaction |
| `hires` | a candidate's accept CROSSES the entry onto its workspace's terminal-role stage — the compare-and-swap winner in `offer-finalize.ts`, gated on the stage ROLE (a board with a post-offer column, or a second link accepted on an already-hired entry, debits nothing) | **Never** |

The asymmetry is deliberate and load-bearing. Publishing is a RECRUITER action, so
refusing it is reasonable. A hire fires on the CANDIDATE's accept — a person taking a
job must never fail because the recruiter's org is over its allowance, so overage is
billed and surfaced, never blocked. The debit is also best-effort there: a metering
fault must not turn a successful acceptance into an error.

Exactly-once on both sides comes from existing invariants rather than new bookkeeping:
`setJobStatus` stamps `published_at` under `COALESCE`, and `markOfferResponded` is a
DB CAS (`UPDATE offers SET status=? WHERE token=? AND status='extended' RETURNING *`)
so only the first responder is claimed. The terminal stage cannot be reached any other
way — a manual move to it is refused in `pipeline-entry-action.ts`.

**AI candidates, case designs and interview minutes remain metered** behind those,
as a safety net with a generous allowance normal use does not reach. They bound a
runaway rather than setting the price — which matters because `llm_usage` still
carries no `org_id`, so there is no per-customer cost ledger to fall back on.

**BYOM's unlimited compute is unlimited on the CUSTOMER'S key** (`effectiveLimit` in
`billing/entitlements.ts`). That is the premise of the tier, and it is priced at half
of Starter because the model spend is theirs. Nothing used to check that the key
existed, so a BYOM subscriber who never pasted one resolved `ai_candidates: null` and
`case_designs: null` against OUR provider keys — unbounded analyses and case designs,
on our spend, on the cheapest paid tier. The unlimited grant now requires a
`byom`-scope row in `provider_keys` (what the admin surface writes when a customer
enters their key; `platform` rows and env vars are the DEPLOYMENT's keys and
deliberately do not count). Without it those two meters fall back to the FREE tier's
allowance — a nudge, not a punishment: everything keeps working at trial scale, the
Billing panel shows the smaller number, and pasting a key restores unlimited on the
next request with no plan change. The outcome meters are untouched: roles and hires
are our product either way. Self-hosted installs never reach this branch (no billing
provider ⇒ no subscription row ⇒ the free plan). Pinned by
`app/_lib/billing/meter-attribution.test.ts` and `app/_lib/billing-reserve.test.ts`.

**The gate and the debit must agree — same tenant, same amount** — which three
times they did not:

| Where | The divergence | Now |
| --- | --- | --- |
| Voice **simulation** (`/api/interview/simulate` → `/api/interview/complete`) | gated on the caller's org, debited on the DEFAULT one — an entry-less session was stamped with the default team, and the debit re-derived the tenant from the (absent) entry | the caller's team is resolved once, stamped on the session row, and the debit reads `session.workspaceId` |
| Voice **simulation**, the AMOUNT (`/api/interview/simulate`) | reserved `durationMin` while `/complete` debits up to `maxBillableInterviewMin(durationMin)` = 2× — the same under-reservation `/create` had already closed, so a demo booked for 8 minutes could bill 16 against a meter with 8 left, landing the overage as unfunded usage on the priciest meter | the gate reserves `maxBillableInterviewMin(durationMin)`, the exact ceiling the debit clamps to; `meter-attribution.test.ts` pins the expression and forbids the bare `minUnits: durationMin` |
| Match-reasoning **degrade** (`reasoning-run.ts`) | asked the DEFAULT team's meter whether to fall back to templates, whichever team was asking | `meterAllows("ai_candidates", { workspace: workspaceId })`, the argument the caller already had |

`InterviewSession.workspaceId` exists for the same reason `PipelineEntry.workspaceId`
does: the row always had the column, the type dropped it, and every caller holding one
had to be told the tenant separately — until one wasn't.

**The active-jobs cap is gone.** It was a CONCURRENCY limit ("how many roles may be
open at once") counted per WORKSPACE while reading an ORG plan, so a five-team org
silently got five times the free allowance. Publishing is now a metered unit like any
other: counted per org, per month, consumed rather than occupied.

**Enterprise** is a fifth, **contact-sales** tier (`plans.ts`, `contactSales: true`):
custom-priced, unlimited meters, granted per signed contract — never sold through
self-serve Polar checkout (the checkout route rejects it with a "talk to sales" 400 —
distinct from the "no longer sold" 400 a `legacy` tier gets — and `isSelfServePlan()`
gates it out everywhere). It shows in the Billing tab and the
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

### Who may open a billing door: `org:manage`, not "any session"

`app/_lib/auth/roles.ts` defines the `org:manage` capability as, verbatim, *"billing,
org profile/settings, delete org — owner only"*. Until 2026-09-03 not one billing route
asked for it. Checkout and portal called `requireOperator()`, which answers a different
question — *is there a valid session on this deployment?* — and every recruiter, hiring
manager and viewer answers it yes; `GET /api/billing` had no handler gate at all. So any
seat could start a checkout that charges the org's card, mint a merchant-of-record portal
URL that **cancels the subscription** and lists invoices, and read the org's plan, metered
burn and prepaid credit balance.

All three doors now go through `requireBillingAuthority()`
(`app/api/billing/authority.ts`), a thin wrapper over `requireOrgCapability("org:manage")`:

- **org-level**, not workspace-level — a subscription is bought per ORG
  (`billingOrgForWorkspace`), so authority over it is org-wide, and an owner administering
  a second team must still be able to pay for it;
- **403 + `BILLING_ORG_MANAGE_REQUIRED`** for a signed-in caller without the capability,
  **plain 401** with no session at all (nothing to localize for yet);
- unchanged for a single-operator install: open dev mode and an operator-password session
  both fold to owner inside `callerOrgCapabilities`.

Pinned by `app/api/billing/billing-authority.test.ts`, which runs with
`KP_OPERATOR_PASSWORD` **set** (billing-routes.test.ts runs open, so the two live in
separate files — the auth helpers read that env at module scope).

### The two spend doors are rate-limited

Authorization and abuse containment are different jobs and neither substitutes for the
other: open mode makes every capability gate in the app a documented no-op, so without a
limiter an unauthenticated caller could loop live Polar checkout sessions and portal
mints. Per-IP `rateLimit()`, placed **after every cheap refusal and before the provider
hop** so a body that was never going to buy anything spends none of the window:

| Door | Budget | Why that number |
| --- | --- | --- |
| `POST /api/billing/checkout` | 10 / 10 min | a person buys once, or retries a card twice |
| `POST /api/billing/portal` | 20 / 10 min | one click per visit, plus a re-open after a popup blocker |

Both refuse through the shared chokepoint (`jsonRefusal("TOO_MANY_REQUESTS", 429)`), and
both call sites — key, constant, budget, ordering — are pinned in
`app/api/rate-limit-contract.test.ts`.

### Every billing refusal carries a code

The routes used to answer prose with no `code`, so the tab computed a genuinely actionable
reason — *use the portal*, *that tier is withdrawn*, *you are not an owner* — and then
discarded it into one generic "Checkout failed", in English, for every locale. Ten codes
now cover the surface (`REFUSAL_ERRORS` / `STORE_ERRORS` in `app/_lib/api-response.ts`,
four catalog entries each): `BILLING_ORG_MANAGE_REQUIRED`, `BILLING_NOT_CONFIGURED`,
`BILLING_PLAN_CONTACT_SALES`, `BILLING_PLAN_WITHDRAWN`, `BILLING_ALREADY_SUBSCRIBED`,
`BILLING_CHECKOUT_BODY_INVALID`, `BILLING_NO_CUSTOMER`, plus `BILLING_OVERVIEW_FAILED`,
`BILLING_CHECKOUT_FAILED` and `BILLING_PORTAL_FAILED` for the fault paths. Where a refusal
names a tier, the tier's **name travels beside the code as data** (`{ plan: "BYOM" }`)
rather than inside a sentence only English readers can parse. Both checkout and portal are
off the `error-response-contract.test.ts` ceiling — the gateway's thrown message (a
merchant-of-record HTTP body) is logged, never forwarded.

### The webhook reads its raw body under a hard cap

`/api/billing/webhook` is on the public allow-list (`app/_lib/auth/public-routes.ts` —
a MACHINE posts here, so the operator gate would 401 Polar), and the standard-webhooks
MAC covers the body, so the body has to be in hand **before** anything can be
authenticated. That read is therefore the first thing an anonymous caller can reach, and
it is bounded: `content-length` is an advisory fast-reject and the real 256 KB budget is
enforced on bytes actually read off the wire (`readTextWithLimit`, the same contract
`/api/agents/report/[token]` and `/api/channels/inbound/[token]` use). Over-budget →
**413**; non-2xx, so a genuine oversized delivery (there is no such Polar payload — an
event is one subscription or order object) is retried and stays visible in the dashboard
rather than being silently swallowed. Pinned by `app/api/billing/billing-routes.test.ts`.

### Settled money we cannot map is an ALERT, never a silent ignore

A verified event whose `product_id` isn't in `productMap()` (almost always
`POLAR_PRODUCT_*` drift — a recreated product, sandbox ids in prod) means the customer
paid and we entitled or credited nothing. The reducer marks those `ignore` actions
`unmapped: true` with a stable `providerRef`, and `applyBillingAction` turns that into
a `console.error` **plus** a durable `billing_alerts` row (`kind: "unmapped_product"`),
deduped on the ref so repeated deliveries collapse to ONE open alert. The response
stays 2xx — a config error will not fix itself on redelivery, so trapping the provider
in a retry loop buys nothing, and the reason is persisted on `billing_events` for audit.

It covers **both settled shapes**: a paying subscription, and — since this pass — a
settled ORDER (`order.paid`, or a refund of one). The order side used to fall into the
same benign ignore as a plan renewal, so a customer could buy a product we could not
identify and nothing at all was logged. Unsettled order chatter (`order.created` /
`order.updated`) for an unknown product stays a silent ignore: nothing has been paid,
so there is nothing to be dark about. A MAPPED plan order is still bookkeeping-only —
the subscription events carry that entitlement.

### What POST /api/billing/checkout refuses

Three server-side refusals, all before the gateway hop (`app/api/billing/checkout/route.ts`,
pinned by `app/api/billing/billing-routes.test.ts`):

- **Not self-serve → 400.** `isSelfServePlan()` covers two different situations and the
  buyer gets the matching message: `contactSales` (Enterprise — custom-priced, talk to
  sales) and `legacy` (BYOM — withdrawn from sale, self-host instead). One shared
  "Enterprise is contact-sales" string used to answer both.
- **Already subscribed → 403, use the portal.** A plan CHANGE must be an in-place swap at
  the MoR; a second checkout would mint a parallel subscription and double-charge. This is
  the trust boundary, not just the catalog's `changeVia` hint. Pack top-ups are exempt —
  one-time, sold on any tier.
- **…but that guard is bounded like the entitlement is.** `hasActiveSubscription()` reads
  the raw stored status while `entitledPlan()` bounds `canceled` by `currentPeriodEnd`, so
  a cancel-at-period-end whose terminal `revoked` never arrived would sit on free
  entitlement AND a 403 — stranded, with a portal that has nothing left to change. The
  route therefore lets a **lapsed** `canceled` row through to a fresh checkout (the
  subscription is dead at the MoR once that date passes, so nothing can double up).
  `past_due`/`unpaid` are deliberately NOT relaxed: those subscriptions are LIVE and in
  dunning. Neither is a `canceled` row with an unparseable period end, where
  `entitledPlan` keeps the plan.

**The catalog's `changeVia` hint mirrors that rule exactly** — `planChangeVia()` in
`app/features/settings/billing/billingTypes.ts` (unit-tested in `billingTypes.test.ts`),
reading the payload's **raw `status`**, not the entitled plan. It used to infer "am I
subscribed?" from `plan.id === "free"`, which diverges from the server for every state
where entitlement lapses while the subscription stays live: a `past_due`/`unpaid` row past
the dunning grace, or an `active` row on a plan id the catalog no longer carries, both
entitle `free` — so the cards offered a Buy button the route 403s. Same set, same single
relaxation (a lapsed `canceled`). `STATUS_TONE` in the same file enumerates the full
`SubscriptionStatus` union for the same reason: `unpaid` used to fall through to the
neutral chip that also means "no subscription".

### The tab's state machine (`billingTabState.ts`)

Four rules that had shipped as inline refs and timer arrays inside `BillingTab.tsx`,
untested because `node --test` cannot load a `.tsx`. They are now pure, named and pinned
by `billingTabState.test.ts`:

- **`createLoadLatch()`** — only the newest `/api/billing` read may land (and its
  failure). Also adopted by `useSpendData.ts`, which had no latch at all.
- **`canStartPurchase` / `isPurchaseBusy`** — single-flight checkout. A successful
  checkout deliberately stays "busy": the page is about to navigate to the provider
  form, and a button that re-enables in that gap mints a second session.
- **`isCheckoutReturn`** — the `?billing=success` flag, captured once in lazy initial
  state because the effect strips the param immediately.
- **`CHECKOUT_POLL_DELAYS_MS` + `checkoutPollWindowMs()`** — the post-checkout poll now
  **backs off to a stated one-minute cap** (2s, 6s, 14s, 30s, 60s) instead of three fixed
  shots that stopped at 5.5s. When the window closes without the plan reflecting the
  purchase, the banner offers a **manual re-check** (`billing.checkoutRecheck`) rather
  than freezing on "payment received, updating" with a page reload as the only recourse.
  The window is DERIVED from the last shot, so "we gave up" can never again sit half a
  second after "we are still trying".

### The Usage & cost section (`app/features/settings/billing/spend/`)

The billing tab renders the plan card, then **one** consolidated spend section,
then the plan catalog. The section combines three reads that used to live on two
different tabs:

| Source | Contribution |
|---|---|
| the tab's `GET /api/billing` payload | this period's plan meters: allowance, remaining, pack credits — **the caller's org** |
| `GET /api/llm/usage` | the `llm_usage` ledger folded per use case over 30 days (`spendUsageFold.ts`, unit-tested) — **the whole deployment** |
| `GET /api/ops` | engine availability, run queue, automation clock, 7-day analyze rollups, comms/schedule failure counters |

`useSpendData.ts` owns both fetches, so the section has **one** loading state and
**one** failure state. The ledger read is the failure that matters; a dead
`/api/ops` drops the engine lines rather than erroring the section. Both halves are
latched to the newest load (`createLoadLatch`, `billingTabState.ts`) — the hook had
none, so a reload fired over an in-flight pair could let a superseded rejection paint
the error state over data a newer read had already delivered.

**The two halves of that row answer at different scopes, and the surface now says so.**
The allowance rail is the caller's org; the AI ledger behind the chart is
**deployment-wide**, because `llm_usage` (`app/_lib/db/core.ts`) carries no `org_id` or
`workspace_id` at all — it is tenancy-**exempt** config/metering, and `aggregateLlmUsage`
has nothing to scope by. Scoping it is a schema change (a column, a backfill, and a
decision about pre-existing rows), so it is out of scope here; what changed is that the
chart states its scope (`billing.spend.breakdownScope`, four locales) instead of letting
a deployment total read as one team's spend against that team's allowance.

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
  decision table, including the unmapped-product alert on both settled shapes.
- `app/_lib/billing/mode.test.ts` — the env half of the open-source seam: a
  credential means commercial, `KP_OFFLINE` never does.
- `app/_lib/billing-gate.test.ts` — the whole stack against a throwaway SQLite
  file via a fake gateway: free limits, allowance debits, pack grants with
  both idempotency layers, plan upgrade via webhook, revoke-to-free, the
  canceled-until-period-end rule.
- `app/_lib/billing/price-reconcile.test.ts` — the price-drift check used by
  `polar-setup.mjs`.
- `app/api/billing/billing-routes.test.ts` — the handlers themselves against real
  standard-webhooks signatures: the signature/idempotency/grant path, the bounded
  body read (413 on both the declared and the chunked oversize), and every checkout
  refusal.
- `app/_lib/db/billing-tenancy.test.ts` — the org axis. The source guard requires
  every statement on `billing_state` / `billing_credits` / `billing_usage` to **bind**
  `org_id` (an `org_id = ?` predicate, or an INSERT naming it in the column list) —
  not merely to mention it, which a cross-org `SELECT org_id, … WHERE plan = ?` would
  satisfy. `billingOrgForProviderRefs` is the one exemption and is named, because it
  is the resolver that looks ACROSS orgs to decide which org to scope to.

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
- Per-team metering breakdowns: meters are ORG-scoped by design (one subscription
  per customer company), so a multi-team org cannot see which team spent what.
  `llm_usage` still carries no `org_id`, which is the other half of the same gap —
  it is written from the Python sidecar off the request path, so propagating the
  tenant through the spawn is the actual work.
