---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-ecommerce-india-ta
character_name: Aisha Khan
role: TA & People Ops Manager
industry: E-commerce / online marketplace (hypergrowth)
size: ~600 (doubling)
region: India / Bangalore
language: en
cert_level: L1
verdict: L1-fail
date: 2026-06-20
method: theoretical (code-grounded surface model; NO browser)
---

# L1 — Aisha Khan walks the full onboarding lifecycle

> Lens: hypergrowth e-commerce TA hiring **eng + ops + warehouse + delivery +
> category + support** in the same week; comp in **₹ LPA all-in CTC**; India
> **DPDP** jurisdiction; 30–90 day **notice periods**; high **volume**. The
> central question at every AI surface: does the output fit *my* world, or is it
> bank-shaped and Czech-shaped?

## Per-stage walkthrough (in character)

**1. Post / ingest the role.** I open Jobs to post my first three reqs: a backend
engineer, a *city operations lead*, and a *last-mile delivery fleet coordinator*.
The taxonomy that classifies and scores everything (`data/taxonomy.json`) is a
pure IT/office skill graph — Python, React, AWS, Scrum, GDPR. There is no term,
no category, no role-family for warehouse, fulfilment, last-mile, rider/fleet ops,
category management, or support. The role-family universe is *derived* from
`salary_benchmarks.json` and is exactly three: `software_engineering`, `data_ai`,
`product_project` (`taxonomy.py:78`). So `classify_role_family` (`taxonomy.py:330`)
can only ever bucket my delivery coordinator as one of three software families.
Two of my three flagship reqs don't exist in this product's worldview. That's the
whole job, on the floor, at stage one.

**2. AI match / shortlist.** Even setting taxonomy aside, the reasoning engine's
system prompt is hardcoded: *"You are a precise technical recruiter for the Czech
tech market"* (`match_reasoning.py:23-24`). And the prompt is fed a thin,
truncated dict — archetype, seniority, 25 skills, matched/missing skills
(`match_reasoning.py:34-75`) — **not the real CV text**. For a software role this
is decent machinery; for my ops/warehouse roles it's a Czech software recruiter
reasoning over a skill graph that has no idea what good fulfilment-ops signal is.

**3. CV analysis / job-fit + salary.** The Gemini analysis prompt: *"You are a
precise HR tech analyst for the Czech Republic technology market"* and
*"Salary numbers are monthly gross CZK based on the current Prague/Czech tech
market"* (`gemini.py:423,433`). The salary schema literally pins
`currency:"CZK", period:"month"` (`gemini.py:79-82`); the pipeline defaults the
same (`pipeline.py:626-627`); the anchor bands are CZK/month
(`salary_benchmarks.json:1-3`) with a 350k **CZK/month** plausibility ceiling
(`salary_band.py:20-33`). My market lives in **annual ₹ LPA all-in CTC**. A
₹18 LPA offer is ₹1.5L/month — which this pipeline would flag as near its garbage
ceiling, or render as "CZK." There is no currency or period control anywhere in
the chain. The comp read is not "off" — it's structurally impossible to state in
my units.

**4. Applicants in the pipeline.** Pipeline board + consent/AI-disclosure exist
(`AiDisclosure.tsx`, consent route). This part travels: the disclosure ("AI
assists, a human decides") is honest and would reassure my candidates too.

**5. Screening decisions.** This is the *strongest* surface and I want to credit
it. The screen-wave runs a **preview (dryRun) before committing** anything
(`screen-wave.ts:114-117,189-193`), a **fail-closed fairness gate** that never
auto-rejects early-career or unknown archetypes (`screen-wave.ts:152-162`),
optimistic CAS so a stale reject is a no-op (`screen-wave.ts:194-209`), a
**tamper-evident sealed decision record** (`screen-wave.ts:215-223`), and a
clean auto/human attribution map (`decision-attribution.ts:15-58,84-87`). Real
human-in-the-loop + audit. *But* the consent/disclosure copy is GDPR/EU-AI-Act
framed (12-month expiry, erasure link — `AiDisclosure.tsx:8-10`); my regime is the
**DPDP Act 2023**, which my legal team checks for by name. The machinery is right;
the jurisdiction label is wrong for me.

**6. Interview schedule + prep + rubric.** Timezone handling exists
(`schedule-slots.ts`, `timezone.ts`) so IST is plausibly representable. Rubric
relevance, though, inherits the same IT-role assumptions; L2 territory.

**7. Group-eval / fair pick.** Fairness + sanity-check machinery present
(`group-eval-run.ts`, `automation-fairness.ts`, `sanity-checks.ts`); structurally
sound, role-appropriateness is an L2 quality call.

**8. Offer.** The offer page renders comp as `salary.toLocaleString(locale)` with
the currency, **falling back to "CZK"** (`offer/[token]/page.tsx:185-192`), and
the currency just rides through from the offer record (`offer-finalize.ts:161-162`)
— which traces to the CZK-defaulted analysis/job. So the offer letter inherits the
wrong-currency/period defect end-to-end. Accept *does* land on a concrete inline
onboarding CTA (`offer/[token]/page.tsx:203-209`) and a deadline countdown
(`:230-241`) — that part is genuinely good and closes the dead-end risk.

**9. Onboarding hand-off.** Templates ARE editable — `createTemplate` accepts
custom tasks via `coerceTasks` (`onboarding-store.ts:131-141`, `onboarding.ts:41`),
so I *could* build an India/blue-collar checklist. But the default every tenant
gets is generic salaried-office (`onboarding.ts:13-21`: contract, ID/tax/bank,
laptop, accounts, buddy, first-day, team intro) — no PF/ESI/UAN, no Aadhaar/PAN, no
BGV, no notice-buyout/joining-date step, nothing for a warehouse/rider cohort. And
the pre-boarding questionnaire is a **fixed const** — `ENTRY_QUESTIONNAIRE_FIELDS`
(`onboarding.ts:25-33`: preferredName, tshirtSize, dietaryNeeds, equipmentPrefs,
emergencyContact, startDateConfirm) — t-shirt size and dietary needs, but no field
to capture a notice period or a UAN. Tasks editable; questionnaire not. E-sign is
honestly disclaimed as a provider seam, not eIDAS (`onboarding.ts:1-6`) — a
strength.

## L1 findings

```yaml
- id: HR20-IN-01
  journey: full-onboarding-lifecycle
  character: hr-ecommerce-india-ta
  cert_level: L1
  type: missing-feature
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: missing
  title: Role taxonomy is IT/office-only — cannot represent e-commerce's non-IT roles
  expected: >
    A role family / skill taxonomy able to represent ops, warehouse/fulfilment,
    last-mile/fleet delivery, category management, and support — the majority of an
    e-commerce TA's reqs.
  got: >
    Role families are exactly three, derived from salary_benchmarks.json
    (software_engineering, data_ai, product_project); the skill graph in
    taxonomy.json is entirely IT/office. No term or family for any blue-collar or
    non-IT operational role; classify_role_family can only bucket into the three IT
    families.
  evidence:
    - pipeline/jobfit/taxonomy.py:78
    - pipeline/jobfit/taxonomy.py:330
    - data/salary_benchmarks.json:6-28
    - data/taxonomy.json:4-168
  code_check: confirmed-absent
  l2_priority: medium  # L1 already decisive; L2 would only confirm output is unusable
  verdict: a delivery-fleet coordinator scored on a software skill graph is unusable

- id: HR20-IN-02
  journey: full-onboarding-lifecycle
  character: hr-ecommerce-india-ta
  cert_level: L1
  type: quality-gap
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Comp is hard-locked to CZK monthly gross — no currency/period for India LPA
  expected: >
    Comp expressible in INR, annual / LPA, all-in CTC (with fixed/variable split),
    with a basis — the only form a comp number is usable in my market.
  got: >
    Gemini salary schema pins currency:"CZK", period:"month"; the prompt states
    salary is monthly gross CZK for the Prague/Czech market; anchor bands are
    CZK/month; the plausibility ceiling is 350k CZK/month; the offer page falls back
    to "CZK". No currency or period control anywhere in the chain. A ₹18 LPA offer
    cannot be stated, and would trip the garbage-detector ceiling if entered.
  evidence:
    - pipeline/jobfit/gemini.py:79-82
    - pipeline/jobfit/gemini.py:433
    - pipeline/jobfit/pipeline.py:626-627
    - pipeline/jobfit/salary_band.py:20-33
    - data/salary_benchmarks.json:1-3
    - app/offer/[token]/page.tsx:185-192
  code_check: confirmed-absent
  l2_priority: high  # confirm the offer letter actually renders CZK/month for my hire
  verdict: comp in the wrong currency and period is instant credibility loss with VP and candidate

- id: HR20-IN-03
  journey: full-onboarding-lifecycle
  character: hr-ecommerce-india-ta
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: AI reasoning + analysis prompts are hardcoded to the Czech tech market
  expected: >
    Reasoning/analysis framed for my industry and market (e-commerce ops + India),
    fed the real CV, judging each role family on its own signal.
  got: >
    match_reasoning system prompt = "a precise technical recruiter for the Czech
    tech market"; Gemini prompt = "a precise HR tech analyst for the Czech Republic
    technology market". The reasoning prompt receives a thin truncated dict
    (archetype, seniority, 25 skills, matched/missing), NOT the real CV text. Good
    machinery fed wrong-domain, thin context.
  evidence:
    - pipeline/jobfit/match_reasoning.py:22-25
    - pipeline/jobfit/match_reasoning.py:34-75
    - pipeline/jobfit/gemini.py:423
    - pipeline/jobfit/gemini.py:433
  code_check: present-broken  # prompts present, but wrong-domain/thin for this Character
  l2_priority: high  # judge live whether ops-role prose is generic/IT-shaped
  verdict: a Czech software recruiter reasoning over my warehouse req won't clear my bar

- id: HR20-IN-04
  journey: full-onboarding-lifecycle
  character: hr-ecommerce-india-ta
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: missing
  title: Onboarding defaults + fixed questionnaire don't fit Indian / blue-collar pre-boarding
  expected: >
    Default tasks/questionnaire that fit Indian statutory + blue-collar pre-boarding
    (PF/ESI/UAN, Aadhaar/PAN, bank, BGV, notice buyout / joining date), or fully
    editable to it.
  got: >
    Default tasks are generic salaried-office (contract, ID/tax/bank, laptop,
    accounts, buddy, first-day, team intro). Tasks ARE editable via createTemplate +
    coerceTasks (a real mitigation), but the pre-boarding questionnaire is a fixed
    const (preferredName, tshirtSize, dietaryNeeds, equipmentPrefs, emergencyContact,
    startDateConfirm) — captures t-shirt size, not notice period or UAN; not editable.
  evidence:
    - app/_lib/onboarding.ts:13-21
    - app/_lib/onboarding.ts:25-33
    - app/_lib/onboarding-store.ts:131-141
  code_check: present-but-missed  # task editability exists; questionnaire fixed + defaults office-shaped
  l2_priority: low
  verdict: I can rebuild the task list, but the questionnaire can't even ask the field I most need

- id: HR20-IN-05
  journey: full-onboarding-lifecycle
  character: hr-ecommerce-india-ta
  cert_level: L1
  type: trust
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: trust
  title: Compliance/consent framing is EU (GDPR/AI-Act), not my jurisdiction (DPDP Act 2023)
  expected: >
    Consent/retention/AI-disclosure framing aligned to India's DPDP Act 2023, or at
    least jurisdiction-neutral and configurable — not presented as EU-only.
  got: >
    AiDisclosure copy is GDPR-shaped (12-month consent expiry, self-service erasure
    link). The human-in-the-loop + audit machinery (screen-wave, sealed records,
    attribution) is genuinely strong and jurisdiction-portable; only the labeled
    regime is wrong for me. (Severity held to minor: the substance my legal team
    needs is present; the framing/labels are EU.)
  evidence:
    - app/_components/AiDisclosure.tsx:6-10
    - app/_lib/screen-wave.ts:152-162
    - app/_lib/screen-wave.ts:215-223
  code_check: present-but-missed
  l2_priority: low
  verdict: right machinery, wrong jurisdiction name — fixable, but it tells me who this was built for

- id: HR20-IN-06
  journey: full-onboarding-lifecycle
  character: hr-ecommerce-india-ta
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: med, reachability: low, trust_erosion: low }
  dimension: trust
  title: Single-tenant lock means I can't truly bring my e-commerce/India dataset
  expected: >
    Ability to load my own job corpus / comp benchmarks / taxonomy so outputs reflect
    my company, not a seeded bank.
  got: >
    Workspace is locked to the default tenant (workspace-lock.ts); the seed is the ČS
    bank/Czech corpus. Noted in the journey as a known ceiling, not a fresh defect —
    but it bounds the entire "fits MY world" question for this Character.
  evidence:
    - app/_lib/workspace-lock.ts:1
    - pipeline/jobfit/seed_jobs_csas.py:10
  code_check: by-design
  l2_priority: low
  verdict: even if comp/taxonomy were fixed, I still can't point it at my own data here
```

## Strengths (do not touch)

- **Screening is a model human-in-the-loop design** — preview-before-commit
  (`screen-wave.ts:189-193`), fail-closed fairness gate (`:152-162`), optimistic
  CAS against stale rejects (`:194-209`), tamper-evident sealed records
  (`:215-223`), clean auto/human attribution (`decision-attribution.ts:84-87`).
  This is jurisdiction-portable and would satisfy DPDP substance if relabeled.
- **Accept lands on a concrete next step** — inline onboarding CTA + deadline
  countdown on the offer page (`offer/[token]/page.tsx:203-209,230-241`); no
  dead-end, which directly protects my offer-drop metric.
- **Honest seams** — onboarding e-sign is openly disclaimed as a provider seam, not
  eIDAS (`onboarding.ts:1-6`); the deterministic reasoning fallback is labeled
  (`match_reasoning.py:115-117`). Honesty I can trust.
- **Onboarding tasks are editable** (`onboarding-store.ts:131-141`) — a real
  mitigation that keeps HR20-IN-04 at major, not blocker.

## Per-journey verdict: **L1-fail**

Two **blockers** sit at stage 1–3 (taxonomy can't represent my roles; comp can't be
stated in my units) and both are structural and code-confirmed, not output-quality
guesses — they block the job before any LLM quality question. Per the rubric, a
structural gap that blocks the job → L1-fail (fix before L2). The downstream surfaces
(screening, offer, onboarding) are well-built but inherit the wrong-domain defaults.

## Grounding score per AI surface

Inputs scored: {real CV, real JD, role/industry taxonomy, market/industry comp,
company size, jurisdiction, prior pipeline history, this Character's own data}.

| AI surface | grounding | note |
|---|---|---|
| Match reasoning | **2 / 8** | real JD + role/seniority reach it; **no real CV text** (thin dict), IT-only taxonomy, Czech market baked in, no my-data, no comp/jurisdiction. `match_reasoning.py:34-75,22-25` |
| CV analysis / job-fit | **3 / 8** | real CV (file bytes) + real JD + deterministic anchor reach it; comp/market/jurisdiction CZK-locked, taxonomy IT-only, no my-data. `gemini.py:423-445` |
| Salary read | **1 / 8** | a deterministic anchor reaches it, but currency/period/market are hard CZK/month — wrong axis for me. `salary_band.py:20-33`, `salary_benchmarks.json:1-3` |
| Screen-wave | **5 / 8** | real pipeline cohort + history + audit + human-loop; jurisdiction label EU, taxonomy IT-only. `screen-wave.ts:98-251` |
| **Overall (this Character)** | **~2.5 / 8** | good machinery, fed bank/Czech/IT context my world can't use. |

## Estimated time-saved + adopt?

**Estimated time saved for Aisha: ~0 hrs (net negative on adoption).** Confidence:
**high** (structural, L1-decisive). The screening-automation machinery *could*
plausibly cut her ~40–60 hrs/month of screening by 50–70% **if** it could represent
her roles and state comp in INR/LPA — but today two of her three flagship reqs can't
be represented at all and every comp number comes back in the wrong currency and
period, so the output is unusable and she'd spend time *correcting* it, not saving.
**Adopt: NO** at L1 for an e-commerce/India TA. (Contrast: for the bank/Czech-IT
Character this same build is plausibly strong — the gap is fit, not quality.)

## First-person review — Aisha Khan

"Honestly? Whoever built this built it *well* — the screening flow is the best
human-in-the-loop design I've seen in a demo this year: it shows me the cut before
it cuts, it refuses to auto-reject a fresher, it seals an audit record, and accept
actually lands the candidate on an onboarding step instead of a thank-you void. If
my whole company were Czech software engineers, I'd be writing the business case.

But it isn't, and that's exactly where it falls apart for me. I hire delivery fleet
coordinators and warehouse leads and category managers in the same week as backend
devs — and this tool has *no idea those jobs exist*. There are three role families
and they're all software. My delivery coordinator gets scored on a software skill
graph. Worse, every comp number comes back as monthly gross CZK — my candidates and
my VP think in **lakhs per annum, all-in CTC**, and a number in koruna-per-month is
something I'd be embarrassed to put in front of either of them. The onboarding even
asks t-shirt size but has no field for a notice period, and my whole life is the
60-day notice gap between offer and joining.

It fits *its* world — a Czech bank's IT hiring — beautifully, and it's honest about
its seams, which I respect. It just isn't *my* world. What's missing for me: a role
taxonomy that knows blue-collar and ops, comp in INR/LPA CTC with a split, DPDP
framing not GDPR, and the ability to point it at my own data. Would I tell a peer
about it? I'd tell a peer running a European software shop to look hard. I'd tell my
own VP: not yet — come back when it can hire a rider."
