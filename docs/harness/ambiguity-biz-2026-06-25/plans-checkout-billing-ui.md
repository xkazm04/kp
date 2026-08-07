# Plans, Checkout & Billing UI — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C1/H3/M1/L0

## 1. "Switch to this plan" offers downgrades as a fresh checkout — contradicting the documented "downgrades via portal" design (double-subscription risk)
- **Lens**: 🌀 Ambiguity
- **Severity**: Critical
- **Category**: billing-correctness / code-vs-doc contradiction
- **File**: app/features/sub_billing/BillingTab.tsx:143
- **Observation**: The PlanCard renders a checkout button for *every* plan that is `!current && plan.id !== "free"` (line 143), with a single generic label `t("plans.cta")` = "Switch to this plan". But the function's own header comment (lines 91–92) states "the free tier has no checkout — **downgrades go through the portal**". So a Growth customer is shown a checkout button for Starter or BYOM (a downgrade / cross-grade), which calls `startCheckout({ plan })` → `/api/billing/checkout` (checkout/route.ts:28) and mints a *new* subscription checkout. Nothing distinguishes upgrade vs downgrade vs cross-grade; there is no proration note, no confirmation, and no recorded reasoning for what happens to the existing active subscription. Whether Polar swaps the subscription or creates a second active one is undocumented and untested.
- **Why it matters**: This is the revenue surface. If a second subscription is created, the customer is double-charged (chargeback + churn + support load); if it silently no-ops they think they downgraded but keep paying the higher tier. Either outcome is a billing-correctness defect, and the UI directly contradicts the stated design.
- **Recommendation**: Decide and document the downgrade path. Either (a) classify each catalog plan vs the current plan (upgrade → checkout; downgrade/cross-grade → route to the portal with a "Manage subscription" CTA + a proration explainer), or (b) confirm Polar performs an in-place swap and label the button accordingly ("Upgrade to…" / "Change plan"). Add a test asserting a downgrade does not create a parallel subscription.
- **Effort**: M

## 2. BYOM shows `interview_minutes: 0` while the product promises "voice runs on your own keys" — the UI never says whether a BYOM user can interview at all
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: undocumented assumption / plan semantics
- **File**: app/_lib/billing/plans.ts:58
- **Observation**: The BYOM plan sets `limits: { ai_candidates: null, case_designs: null, interview_minutes: 0 }` (line 58), i.e. text/cases are unlimited but interview minutes are metered at **zero** included. Yet the file header (line 4) says BYOM "runs text AI + **voice** on the customer's own keys, so there is nothing of ours to meter," and the landing copy reinforces "Your ElevenLabs key runs the interviews" (messages/en.json:418). These conflict: if voice runs on the customer's key, interview_minutes should be `null` (unmetered) like the other two; if it's `0`, BYOM users can't interview without buying a pack. The Billing tab renders this raw ("Interview minutes: 0", MeterRow at BillingTab.tsx:64) with no explanation, so a BYOM recruiter cannot tell whether interviews work, require an ElevenLabs key, or require a purchased pack — pure tribal knowledge.
- **Why it matters**: Interviews are a core promise. A BYOM customer who reads "0 minutes" may conclude the feature is unavailable (churn), or be surprised they must buy a pack (trust/dispute). The contradiction also makes the BYOM revenue model unverifiable.
- **Recommendation**: Resolve the intent in plans.ts and surface it: if BYOM voice is on the customer's key, set `interview_minutes: null` and label it "Unlimited (your ElevenLabs key)"; if KP meters BYOM voice, keep `0` but add a one-line plan note ("Interview minutes via the 100-minute pack, or connect your own ElevenLabs key"). Mirror the resolution in docs/BILLING.md.
- **Effort**: S

## 3. Quota-exhausted meter shows a red "Quota exhausted" badge but no upgrade / buy-pack CTA at the exact moment of highest willingness to pay
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: conversion lever / value left on the table
- **File**: app/features/sub_billing/BillingTab.tsx:80
- **Observation**: When a meter is depleted, MeterRow renders `<Badge tone="critical" label={t("usage.depleted")} />` ("Quota exhausted", line 80) and the count turns coral — but there is no inline call to action. The recruiter who just hit their AI-candidate or interview-minute ceiling (peak intent) must scroll past Usage, find the Plans grid, and self-diagnose which plan or pack solves it. The minutes pack and higher plans exist on the same page yet are not linked from the point of pain.
- **Why it matters**: Depletion is the single best in-product upgrade trigger. Surfacing the right action there (upgrade tier for candidate/case meters; "Buy 100 minutes" for interview_minutes) is a high-conversion, low-effort lever that's currently unused on the revenue surface.
- **Recommendation**: In MeterRow, when `depleted`, render a small CTA next to the badge that deep-links to the relevant next step — "Buy minutes" (scroll to / trigger the pack checkout) for `interview_minutes`, "Upgrade plan" for capped meters. Reuse the existing `startCheckout` handlers.
- **Effort**: S

## 4. Monthly-only billing — no annual plan or discount anywhere in the catalog
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: monetization / retention & cash-flow lever
- **File**: app/_lib/billing/plans.ts:37
- **Observation**: Every paid plan is priced per-month only (`priceCzk: 490` etc., line 37–52; UI label "per month" at BillingTab.tsx:337 / en.json:3239), and the Polar setup script provisions only monthly subscription products (`POLAR_PRODUCT_STARTER/GROWTH/BYOM` "(subscription)", polar-setup.mjs:103–104; the only non-recurring product is the minutes pack, line 121). There is no annual option, no "2 months free", and no toggle. A repo-wide grep for `annual|yearly|interval` finds nothing in the billing module.
- **Why it matters**: Annual billing is a standard SaaS lever that lifts cash collected upfront, cuts monthly churn, and raises LTV — typically a ~15–20% discount in exchange for a 12-month commit. At these price points (490–1190 Kč/mo) an annual tier is the cheapest retention win available and a visible competitive gap.
- **Recommendation**: Add annual variants (e.g. `starter_annual`) with a documented discount, a monthly/annual toggle on the Plans grid, and corresponding Polar yearly products in polar-setup.mjs. Record the discount rationale in docs/BILLING.md.
- **Effort**: M

## 5. Displayed USD prices are hardcoded "approximate" constants fully decoupled from what Polar actually charges, with no FX rationale or guardrail
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic numbers / undocumented trade-off
- **File**: app/_lib/billing/plans.ts:7
- **Observation**: The file comment (lines 6–9) is explicit: "Prices here are DISPLAY values… the amounts actually charged live on the provider's product objects… the code only ever references products by id." So `priceUsdApprox: 21 / 50 / 5` and the pack's `34` (lines 41, 49, 57, 82) are hand-entered approximations shown to the user (BillingTab.tsx:125 "≈ $21"), while the real USD amount is whatever was set on each Polar product in the dashboard. The implied FX (~23–24 CZK/USD) is undocumented and will drift, and only the pack price ($34) is actually asserted by polar-setup.mjs (line 23); the subscription USD amounts are created manually with no cross-check against these display constants.
- **Why it matters**: A US/non-CZK recruiter sees "≈ $21/mo" then gets charged a different USD amount at the Polar-hosted page — a quiet trust/dispute/chargeback risk on the revenue surface, and a silent-drift hazard whenever FX moves or a dashboard price is edited.
- **Recommendation**: Either treat the Polar product price as the source of truth (have polar-setup.mjs assert the USD subscription amounts and surface a "prices may vary by currency at checkout" note), or document the FX basis and date next to the constants and add a test that flags drift > a threshold.
- **Effort**: S
