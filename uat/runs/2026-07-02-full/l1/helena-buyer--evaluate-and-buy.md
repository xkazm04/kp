# L1 theoretical — helena-buyer × evaluate-and-buy

- **Run:** 2026-07-02-full · main @ 3395b4c
- **Character:** Helena Bauer — Head of Talent Acquisition (Erste/ČS), prospect **economic buyer**
- **Journey:** Evaluate & buy — a 20-min credibility / ROI / compliance check, then pilot
- **Verdict:** **L1-conditional** (the designed evaluation walk completes and is genuinely strong; the launch/conversion seam carries two blocker-severity findings to L2)
- **Grounding score:** **6/11 (~55%)** across the sim's three buyer-visible AI beats (screen draft 1/4 · offer draft 3/4 · group-eval 2/3 — breakdown below)
- **Time-saved estimate:** ~2–3 weeks of vendor vetting (demos-with-SEs, RFP, reference calls) compressed to **~25 min self-serve** to a defensible pilot/no-pilot memo — **confidence: medium**, and only on a deploy where the demo is actually served; on today's production config the path does not exist, and *starting* a pilot still requires vendor contact either way.

---

## 1. Surface model (code-derived, import chains followed)

### 1.1 The public root `/` — who actually gets what

- `app/page.tsx:23-40` — `/` is `HomeGate(landing=<SparkHome/>, dashboard=<Workspace/>)`; `?sim=auto` forces the dashboard for the guided demo (`:28-31`).
- **The gate is DEV-ONLY.** `app/_lib/auth/devAuth.ts:28` — `DEV_GATE = NODE_ENV !== "production"`; `:30-31` — in production `isDevAuthed()` returns `true`, so `/` **always mounts the dashboard** (`app/_components/auth/HomeGate.tsx:27-30`). The file's own comment (`devAuth.ts:22-27`): *"the built public landing (SparkHome) is NOT served to prod visitors — top-of-funnel is dark on purpose."*
- `app/landing/page.tsx:6-8` and `app/landing/spark/page.tsx:7-9` — both standalone landing routes `redirect("/")`. **There is no production URL that serves the marketing landing.** (They're still in the proxy's public allow-list, `proxy.ts:17` — dead public routes that bounce into the gate.)
- **Gated production** (`KP_OPERATOR_PASSWORD` set): `proxy.ts:53-82` — `/` is not in `PUBLIC_PAGES`, so an unauthenticated visitor is **redirected to `/login?next=/`** (an operator password form, `app/login/page.tsx`, copy: *"This workspace is protected. Enter the operator password"*, `messages/en.json → login.subtitle`). Fail-closed no-password prod does the same (`proxy.ts:52,56-66`).
- Documented as deliberate: `docs/DESIGN.md:285-306` — *"Public landing (status: BUILT, NOT LAUNCHED)"*, with the launch checklist (CTA wiring, SEO/OG, social proof).

**Net for Helena:** in production her landing page is a password wall; the only public marketing surface is `/about`.

### 1.2 `/about` — the one public marketing page that survives production

- `app/about/page.tsx:10-22` — public, indexed (explicitly "meant to be found"), renders `AboutHome` → `AboutCurve` (`app/landing/spark/AboutHome.tsx:30-36`).
- `AboutCurve.tsx:24-32` + `messages/en.json → aboutPage.steps.*` — a concrete 7-step JD→hire walk (design/source/intake/screen/interview/offer/hired) with mechanism-level copy: *"hard knock-out gates and archetype-aware scoring — deterministic and explainable, never keyword bingo"* (source), *"A fairness gate runs first… everything else is held for a human"* (screen), *"The offer figure is deterministic — role band × fit, no LLM in the number"* (offer). Closing thesis: *"AI does the reading at every step. A human signs every decision."*
- CTAs: header Sign in (`AboutCurve.tsx:108-114`) and closing **"Start free"** (`:160-167`) — both `onSignIn` (`:91`): dev → `signInDev()`, **prod → `/login`** (the operator password box). **There is no demo CTA anywhere on /about** — the only link to `/api/demo` in the codebase is on the unlaunched landing (`SparkLanding.tsx:278-281`).

### 1.3 The landing content (served at `/` behind the dev gate)

`app/landing/spark/SparkLanding.tsx` (via `SparkHome.tsx:31-37`):
- Nav + hero CTAs `:171-195, :267-285` — "Start screening free" → `signInDev`/`/login`; **"Watch the live demo" → `/api/demo`** (`:278-281`); voice-teaser anchor.
- **Compliance section** `:533-579` (`COMPLIANCE` pillars `:60-65` + `messages → landing.trust.*`): human-in-the-loop (*"by design, not by a setting"*), EU AI Act high-risk framing, **GDPR & Article 22** (consent, human review, erasure, *"No solely-automated significant decisions"*), tamper-evident audit + calibrated confidence — and an honest footnote: *"this reflects the product's design and controls, not a legal certification."* No contradicting fully-automated claim anywhere in the `landing`/`aboutPage` namespaces (hero badge: *"AI for hiring that keeps humans in charge"*).
- **Pricing** `PricingSection.tsx` — four metered tiers (`TIER_STYLES:15-20` + `landing.pricing.tiers.*`), meters are candidates/cases/minutes (never tokens), CZK primary + USD approx, meter definition footnoted (*"'AI candidate' = one person fully worked"*). **Enterprise band with sourced ROI stats** `:105-126`: 60–70% less screening time · ~23 h manual screening/hire · 40–51 h total recruiter hours/hire, with a source line naming 2025 SHRM/time-per-hire studies and pointing at Analytics → ROI for measured savings. All tier CTAs `href="/login"` (`:93`), enterprise **"Talk to sales" → `/login`** (`:111`).
- i18n en/cs with `LandingLangSwitch` (`SparkLanding.tsx:623`, `AboutCurve.tsx:181`).

### 1.4 The keyless guided simulation (her "see it work" proof)

- Entry: `app/api/demo/route.ts:19-47` — public (`proxy.ts:21`), rate-limited (`:22-24`). Open dev: no cookie needed. **Gated deploy: refuses to mint the demo session unless explicitly allowed** (`:32-34` → silent `redirect("/")`); `demoSessionAllowed()` (`app/_lib/workspace-lock.ts:42-46`) defaults OFF because *"this anonymous recruiter session can read the real tenant's PII via the ~28 unscoped tables"* (`route.ts:29-31`; tenancy half-built per `workspace-lock.ts:1-16`).
- Lands `/?sim=auto` → `forceDashboard` (`app/page.tsx:28-31`) → auto-start in play mode (`SimulationProvider.tsx:686-699`).
- The sim spine is **deliberately keyless/deterministic**: screening draft `app/api/sim/screen-draft/route.ts:7-24` (*"NO LLM"* — canned rationale, fixed confidence 72); offer draft `app/api/sim/offer-draft/route.ts:8-32` (real job-band midpoint, no LLM — consistent with /about's "no LLM in the number"); group-eval runs the **real** `group_eval` task with honest timeout/error states (`SimulationProvider.tsx:273-321`); screen wave carries real reason codes (`SimulationProvider.tsx:18-22`). Failure policy is honest-halt, not silent-wrong (`:255-268, :302-317`).
- Done state: conversion CTA **"Get started — do it with your roles" → `/login`** (`SimBar.tsx:47-57`) — peak intent, password wall.

### 1.5 Billing — plan catalog, checkout, webhook entitlement

- Tab: `app/features/tabs.ts:148-152` (Settings group) · `tabHref → /?tab=billing` (`:163-165`). `sim` param isn't tab-scoped (`TAB_SCOPED_PARAM_KEYS:210-230`), so a demo-session prospect can open Billing mid-demo.
- `app/features/sub_billing/BillingTab.tsx` renders `GET /api/billing` (`app/api/billing/route.ts:12-27`, not operator-gated): entitled plan + status badge, period end, per-meter usage bars + pack credits (`MeterRow:43-89`), plan catalog, minutes pack, provider portal. `configured:false` renders the honest note *"Billing isn't configured — running in local development mode. Purchases are disabled."* (`:337-343`).
- **Correctness chain (strength):** checkout URL is server-minted, client redirect-only (`app/api/billing/checkout/route.ts:9-11,43-45`; `BillingTab.tsx:254-269`); checkout is operator-gated defense-in-depth (`checkout/route.ts:16-17`); **entitlement lands ONLY via the signature-verified, idempotent webhook** (`app/api/billing/webhook/route.ts:8-11`; standard-webhooks HMAC in `app/_lib/billing/webhook-verify.ts:25-54`); plan *changes* route through the portal to prevent a parallel-subscription double-charge (`BillingTab.tsx:93-96,430`); entitlement resolution favors the paying customer on `canceled`/`past_due` edge states (`app/_lib/billing/entitlements.ts:29-46`); allowance exhaustion degrades to deterministic fallbacks, never blocks reads (`entitlements.ts:3-6`).
- **Reconciliation (strength):** landing pricing ↔ `plans.ts` agree 1:1 — Free 0 Kč/5 candidates/1 case/1 job, Starter 490 Kč/100/5/30 min, Growth 1 190 Kč/400/20/120 min, BYOM 120 Kč/unlimited-on-your-keys, pack 790 Kč/100 min (`app/_lib/billing/plans.ts:28-84` ↔ `messages/en.json → landing.pricing`).

### 1.6 Reachability — Helena's set (judged ONLY here)

| Surface | Reachable? |
|---|---|
| `/about` | ✅ always public (`proxy.ts:17`) |
| Landing at `/` | ⚠️ dev-gate deploys only; **production: never** (`devAuth.ts:28`) |
| Keyless sim (`/api/demo` → `/?sim=auto`) | ⚠️ open dev yes; gated deploys only with `KP_DEMO_ENABLED`; **not linked from /about** |
| Billing tab (`/?tab=billing`) | ⚠️ via demo session sidebar or dev gate; GET overview ungated |
| Seeded internal tabs (Pipeline, Analytics, …) | ❌ `unreachable` for Helena — not judged (deferred to internal Characters) |

### 1.7 Grounding audit (sim AI beats she watches)

| Surface | Real context that should reach the output | Reaches it | Score |
|---|---|---|---|
| Screening draft (`sim/screen-draft:17-23`) | CV evidence, JD rubric, score, fairness gate | job title only; canned strengths, fixed confidence 72; rationale claims what the code doesn't do | **1/4** |
| Offer draft (`sim/offer-draft:18-32`) | job salary band ✓, candidate ✓, currency ✓, fit-scaling ✗ (rationale says "scaled by fit", code is pure midpoint `:23` vs `:31`) | mostly | **3/4** |
| Group eval (`SimulationProvider:273-321`) | real pipeline entries ✓, real match scores ✓, LLM reasoning only when keyed (deterministic fallback) | real machinery, honest timeout | **2/3** |

**Journey grounding: 6/11.** "Good machinery fed thin context" applies to exactly one beat — the screening rationale — but it's the beat Helena's credibility criterion hangs on.

---

## 2. Cognitive walkthrough (in-character, over the designed surface)

**Beat 1 — land cold.** On the deploy she'd realistically be shown (dev gate / demo enabled): the Spark landing is loud but concrete — the hero says what the machine does and what stays human, the pile is interactive, the "Watch the live demo" affordance is exactly where I'd look (`SparkLanding.tsx:278`). *Will I try it? Yes.* On **production as configured**: I get a password box at the root (`proxy.ts:78-81`). I close the tab — finding EB-H1-01.

**Beat 2 — credibility check on /about.** Seven steps, each naming a mechanism (knock-out gates, fairness-gate-first, deterministic offer math, human gate per step). This reads like a system, not adjectives — my Eightfold/SeekOut radar doesn't fire. *But* there's no way from this page to the demo (EB-H1-03) — the "prove it" link is missing from the one page I can reach in production.

**Beat 3 — run the demo.** Structurally: `/api/demo` mints an isolated session, `?sim=auto` auto-plays JD→Hired with pause/step, real UI clicks, an explain drawer, honest failure states. Keyless — my pet peeve is answered by design. The screening beat, though, shows a canned rationale with a hard-coded 72 (EB-H1-05); if I pressure-test the one sentence closest to me, the offer rationale claims fit-scaling the code doesn't do. On a gated deploy without the opt-in flag, the CTA silently lands me back where I started (EB-H1-03) — a demo that "breaks in front of me" is an instant close-tab.

**Beat 4 — compliance.** The trust section answers, in order: human-in-the-loop by design, AI-Act high-risk posture, Art. 22 + consent + erasure, auditability — and then *disclaims itself* ("not a legal certification"), which I trust MORE, not less. I could hand this to Legal as the vendor's claimed posture. PASS — with the isolation caveat (EB-H1-04) as the question Legal would ask first: "and the demo itself can't see real candidate data, correct?" The code says: only if the operator configured it correctly (`workspace-lock.ts:35-46`).

**Beat 5 — ROI.** Numbers I recognize (60–70%, ~23 h/hire) with a source line, plus "your own measured savings show live in Analytics → ROI" — a claim structured to be verified in a pilot. PASS.

**Beat 6 — pricing → pilot.** The tiers map to meters I understand; the billing machinery under them is real (webhook-entitlement, portal, honest dev-mode note). Then I click any plan — or "Talk to sales" — and hit an **operator password form** (EB-H1-02, EB-H1-06). There is no signup, no tenant creation (locked single-workspace, `workspace-lock.ts:24-27`), no contact route. The funnel ends one click before money.

**20-minute budget:** landing+about ~7 min, demo ~8-10 min, pricing/billing ~5 min → the *decision* fits the budget. The *pilot start* is unreachable self-serve.

---

## 3. Scored acceptance criteria (Helena's own, applied as written)

| # | Criterion | Verdict |
|---|---|---|
| 1 | **completion/trust** — guided sim runs keyless end-to-end, doesn't break | **PASS structurally** on open/demo-enabled deploys (deterministic spine, honest-halt failure policy); **FAIL on gated deploys** (silent refusal `demo/route.ts:32-34`) and **unreachable from /about**, the only prod marketing page → carried as EB-H1-03; live run = L2 |
| 2 | **trust/senior-quality** — matching shows real reasoning, not fluff | **MAJOR gap** — the demo's screening rationale is a canned template w/ fixed confidence (EB-H1-05); group-eval + screen-wave machinery is real and partially offsets; L2 to judge what's actually visible |
| 3 | **missing** — concrete compliance story (human-in-the-loop, Art. 22, disclosure) | **PASS** — 4 public pillars + honest non-certification footnote + /about human-gate narrative; no contradicting claim found |
| 4 | **time-saved** — ROI math shown and sourced | **PASS** — 60–70% / ~23 h / 40–51 h with named source studies + a verify-in-product pointer (`PricingSection.tsx:105-126`) |
| 5 | **trust** — pricing present, maps to value | **PASS** — metered tiers ↔ `plans.ts` 1:1, meter defined, CZK+USD, pack; billing engine actually implements it |
| 6 | **clarity** — differentiation vs Eightfold/SeekOut/HireEZ/Beamery legible | **PASS (thin)** — the reasoned/grounded/deterministic-gates edge is *stated* repeatedly; no direct competitive frame, but it clears "stated, not implied" |
| 7 | **effort** — defensible pilot/no-pilot decision in ~20 min self-serve | **PASS for the decision** on a reachable deploy; **FAIL for the pilot start** — every conversion affordance dead-ends at the operator password (EB-H1-02); in production the whole journey is unreachable (EB-H1-01) |

---

## 4. Findings

See `evaluate-and-buy.findings.json` for the full schema. Ranked by impact:

1. **EB-H1-01 · blocker** — Public product path not launched: prod `/` is an operator password wall; the landing is served at no URL. (`devAuth.ts:28`, `HomeGate.tsx:27-30`, `proxy.ts:53-82`, `landing/page.tsx:6-8`; documented `docs/DESIGN.md:285-306`)
2. **EB-H1-02 · blocker** — No marketing→signup/pilot path: every CTA → single-operator `/login`; no signup, workspace creation locked, checkout operator-gated. (`PricingSection.tsx:93,111`, `AboutCurve.tsx:91`, `SimBar.tsx:52-54`, `workspace-lock.ts:24-27`, `checkout/route.ts:16-17`)
3. **EB-H1-03 · major** — Demo CTA silently dead-ends on gated deploys and is absent from `/about`. (`demo/route.ts:32-34`; no `/api/demo` link in `AboutCurve.tsx`)
4. **EB-H1-04 · major** — Demo-session "isolation" is contradicted by half-built tenancy (~28 workspace-blind tables incl. candidate PII) if the opt-in flag is enabled on a data-holding deploy. (`workspace-lock.ts:35-46`, `demo/route.ts:29-31`)
5. **EB-H1-05 · major** — The demo's screening "reasoning" is a canned template (fixed 72, boilerplate strengths; offer rationale overstates "scaled by fit" vs pure midpoint). (`sim/screen-draft/route.ts:17-23`, `sim/offer-draft/route.ts:23,31`)
6. **EB-H1-06 · minor** — "Talk to sales" opens the operator password form. (`PricingSection.tsx:111`)
7. **EB-H1-07 · minor** — Off-brand root SEO/OG: "KP Job Fit & Salary Estimator" vs the KandiDate brand on every marketing surface. (`layout.tsx:35-36` + `messages meta` vs `SparkLanding.tsx:167-169`)
8. **EB-H1-08 · strength** — Senior-grade billing correctness (webhook-only entitlement, portal-vs-checkout discipline, honest unconfigured state, customer-favoring entitlement edges).
9. **EB-H1-09 · strength** — Marketing ↔ billing-engine reconciliation holds 1:1; compliance footnote and ROI source lines make claims verifiable, not asserted.
10. **EB-H1-10 · strength** — The compliance story a bank buyer needs is public, concrete, and uncontradicted.

Accepted-gaps check: none of the above match the only baseline entry (tokenized-page 404s).

---

## 5. l2_priority — what L2 must confirm live (in order)

1. **Cold root visit, logged out, on the running deploy:** which surface renders at `/` — landing, dashboard, or login wall? (EB-H1-01)
2. **Click "Watch the live demo":** does `/api/demo` mint + auto-start `?sim=auto`? Time the full JD→Hired run; does anything break or stall; does the 20-min budget hold? (criterion 1)
3. **During the demo session, open Pipeline/Profile:** whose candidate rows show — demo-workspace rows only, or the seeded tenant's PII? (EB-H1-04 — the question Legal asks)
4. **At the screening beat:** what reasoning is actually visible (canned one-liner vs reason-coded screen wave vs group-eval comparison) — would a skeptical buyer read it as real reasoning? (EB-H1-05)
5. **Open Billing mid-demo:** catalog renders, `configured:false` note honest, plan CTAs disabled (not erroring); or on a configured deploy, checkout URL round-trip + `billing=success` confirm-poll. (criterion 5)
6. **Follow every conversion CTA live** ("Start free", plan CTAs, "Talk to sales", post-demo "Get started"): confirm the password dead-end end-to-end. (EB-H1-02, EB-H1-06)
7. **LandingLangSwitch + Spark art direction** render; English throughout for the buyer locale.

---

## 6. Helena's feedback (first person, over the designed experience)

"Twenty minutes with this, and I'm genuinely torn — which is rare; most 'AI recruiting' pitches lose me in five.

What impressed me: the story is *mechanical*, not magical. The about page walks one hire through seven steps and names the controls at each — fairness gate first, deterministic offer math, a human signing every decision. The compliance section reads like someone actually briefed a DPO: Article 22, consent, erasure, audit — and then it *tells me it isn't a legal certification*, which is exactly the kind of honesty that makes me trust the rest. The ROI numbers are the real benchmarks, with sources, and the pricing is the first I've seen in this category with no token math — the tiers on the landing match the billing engine underneath to the crown. And a keyless demo that plays the whole pipeline in front of me, pause button and all, is precisely the self-serve proof I keep asking vendors for and never get.

What stops me: I checked what actually ships at the front door, and there isn't one. In production your root is a password box, the landing this pitch lives on is served nowhere, and the demo isn't even linked from the one public page you do have. Every 'Start free', every plan button, even 'Talk to sales' — they all end at an *operator* login. I cannot start a pilot, I cannot start a checkout, I cannot even leave my email. And when I pressure-tested the demo's reasoning — my whole reason to believe — the screening rationale turned out to be a stamped template with a confidence of 72, every time, for everyone. If my legal team then asks whether the anonymous demo can see real candidate data, the honest answer today is 'only if the vendor configures it wrong' — for a bank, that answer needs to be 'no, structurally'.

Would I pilot? Not from what's launched — there's nothing launched to pilot. Would I take a meeting? Yes, and quickly: the machinery under this funnel — the human-gate design, the webhook-clean billing, the honesty in the seams — is more real than three of the four platforms I've evaluated this year. Ship the front door: landing live, a demo link on /about, one signup path into an isolated tenant, and a screening rationale in the demo that's genuinely computed. Do that and I'd bring this to the board myself."
