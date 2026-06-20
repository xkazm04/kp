---
name: evaluate-and-buy
promotion: discovery
surfaces: [Landing & Marketing, /landing, /landing/spark, /about, Plans Checkout & Billing UI, Billing Engine & Webhooks]
characters: [helena-buyer]
language: en
---

# Evaluate & buy — a 20-min credibility / ROI / compliance check, then pilot

## Goal (in Helena's words)
"I run TA for a bank under the EU AI Act. In twenty minutes I want to decide whether to pilot this —
does it credibly save recruiter hours, is the ROI verifiable, and does it satisfy GDPR / AI-Act /
human-in-the-loop? If it's just 'AI-powered' fluff and vague pricing, I'm out."

## Definition of done (user POV)
- The marketing/about story is concrete: a real JD→hire pipeline, "AI reads, a human signs every
  decision" — not buzzwords.
- A verifiable ROI hook (the ~60-70% screening-time cut), and a compliance story (human oversight,
  disclosure, GDPR retention) I could defend to Legal.
- Pricing maps to value (plans + metered usage), and I can see how to start a pilot.

## Entry state / preconditions
- **No auth, no keys, no seed.** Helena reaches ONLY public marketing (`/landing`, `/landing/spark`, `/about`),
  the keyless guided simulation, and the Billing tab — NEVER the seeded internal data (`rubric.md` reachability).
- Billing tab reachable via the dev gate for evaluation, but entitlement/checkout is the buyer-facing slice.

## What L1 must check (structural, code-grounded)
- **Reachability (the discipline):** judge findings ONLY on the buyer's set. `/about` is the public concept intro
  (`app/about/page.tsx:4-9` — meant to be found, unlike noindexed `/landing`) and its copy already states the thesis:
  "AI does the reading at every step; a human signs every decision" (`page.tsx:14-17`). A finding on an internal tab Helena
  can't open is `unreachable` — don't score it against her.
- **Substance over fluff:** `/landing/spark` carries `FeaturePreviews` + `PricingSection` (context "Landing & Marketing").
  Check that the pipeline claim is shown as a concrete JD→hire walk (the /about narrative + the guided sim), not adjectives.
- **ROI is verifiable, not asserted:** the credible number is the research anchor (~23 hrs screening/hire → 60-70% cut). Flag if
  marketing states an ROI with no path to verify it — the calibration surface (`/api/analytics/calibration`) is the proof, but
  Helena can't reach it; so the marketing must point to the keyless simulation as the "see it work" proof.
- **Compliance story present:** the human-in-the-loop + disclosure framing must be on the public surface (it is, `/about` copy);
  cross-check it isn't contradicted (no "fully automated decisions" claim anywhere on marketing).
- **Pricing maps to value:** `BillingTab` renders the entitled plan, this period's metered usage (included allowance + pack
  credits), the plan catalog with checkout, and a minute top-up pack (`app/features/sub_billing/BillingTab.tsx:11-26`).
  Entitlement lands via the **webhook**, never the client (`:11-17`; `/api/billing/webhook`, `webhook-verify.ts`) — a correctness
  strength. `configured:false` is honest unbilled local dev (`:23`).

## What L2 must confirm (live-only)
- **l2_priority — the 20-min walk:** land cold on `/about` → run the guided simulation → open Billing. Assert Helena can build a
  defensible ROI + compliance narrative end-to-end WITHOUT auth or keys, and reach a "how to pilot/checkout" next step.
- **No fluff / no contradiction:** every "AI" claim is backed by a shown mechanism; no solely-automated-decision language anywhere.
- **Pricing legibility:** plan → entitlement → metered usage is understandable; checkout URL comes from the server, redirect only.
- **English throughout** (buyer locale), `LandingLangSwitch` present; Spark Dark art direction renders (it's a fixed art direction).

## Out of scope / known
- The seeded internal workspace + any per-tenant data — `unreachable` for Helena by design; defer to L2 of internal Characters.
- Real Polar checkout / webhook delivery — `configured:false` locally is expected; live billing is a `scope_note`.
