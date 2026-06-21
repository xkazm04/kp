---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-insurance-head-ta
character_name: Marcus Feldman
role: Head of Talent Acquisition — US insurance carrier (~15,000 employees, enterprise)
cert_level: L1
language: en
verdict: L1-conditional
method: code-grounded surface walk, no browser
---

# Marcus Feldman · full-onboarding-lifecycle · L1

> Fit lens: niche **licensed** roles (Series 7/63, actuarial ASA/FSA, state
> producer/adjuster licenses, underwriting authority); a legacy **Workday** ATS he
> must integrate with, not replace; enterprise procurement + infosec; **EEO/OFCCP**
> reporting and adverse-impact review; deeply skeptical of any island that can't
> export or write back. Onboarding must feed Workday, not be a separate island.
> Central question per surface: does this output fit US insurance, or is it
> bank-shaped and Czech-shaped?

## Per-stage walkthrough (in character)

**1. Post / ingest the role.** I open Jobs and a role goes in fine. But the role
brain is `data/taxonomy.json`, and when I scan it for *my* world it isn't there.
"Insurance" exists only as a keyword that classifies a *company* as enterprise
(`taxonomy.json:150`). There is no Series 7, no Series 63, no ASA/FSA, no
underwriting authority, no licensed claims adjuster, no producer license — the whole
graph is software/data/product/IT (`taxonomy.json:4-168`). So the moment the matcher
reads my variable-annuity sales req or my pricing-actuary req, it has no concept of
the one gate that legally decides who can do the job. That's not a missing nice-to-have;
it's the spine of insurance hiring missing.

**2. AI match / shortlist.** The machinery is real and grounded — match reasoning
runs the actual CV + JD through a Python pipeline. But it ranks on skills and
seniority. A license is, at best, a skill bullet it might echo if the CV mentions it
— never a pass/fail legal gate. A shortlist that ranks an unlicensed candidate above
a licensed one for a Series-7 desk role is, to me, wrong even if the prose is fluent.

**3. CV analysis / job-fit + salary.** The extraction is strong. The **salary read
is built for a different planet**: `data/salary_benchmarks.json:2` is hardcoded
`"currency": "CZK"`, `"market": "Czech Republic monthly gross"`, with three role
families (software/data/product) and zero insurance/actuarial/underwriting. The whole
presentation layer is pinned to CZK: `app/_lib/format.ts:6` `LOCALE="cs-CZ"`, `:18`
`APP_CURRENCY="CZK"`, and the file states outright "the app does not do FX." A US
annual insurance comp number simply cannot come out of this; a CZK/monthly band on my
underwriter role is worse than silence — it tells procurement this wasn't built for us.

**4. Applicants in pipeline.** Drawer, consent, AI-disclosure surfaces exist — good.
Reachable, populated by the seeded (bank) pipeline.

**5. Screening decisions.** This is the strongest stage *and* the one my legal team
will still block on. The screen-wave has genuine human-in-the-loop: a dry-run preview
that commits nothing (`screen-wave.ts:113-117,189-192`), a fail-closed fairness gate
(`screen-wave.ts:152-162`), CAS so a stale reject is a no-op (`:204-209`), and a
sealed, replayable audit record per auto-rejection (`decision-record-store.ts` via
`sealDecisionSafe`, `screen-wave.ts:215-223`). Attribution honestly separates auto
vs human and refuses to default unknown kinds to "auto" (`decision-attribution.ts:84-87`).
But the "fairness" is **archetype/early-career** based — it shields juniors and
unknown archetypes. There is **no protected-class adverse-impact / four-fifths read**
anywhere in the pipeline (grep for EEO/OFCCP/adverse-impact/four-fifths hits only
other UAT docs, landing copy, and message catalogs — never pipeline code). For a US
federal contractor, "fair" without a protected-class disparate-impact story isn't a
defensible record.

**6. Interview schedule + prep + rubric.** Timezone/slot machinery present; rubric is
generic role-family, not insurance-licensed-role specific. Usable, not tailored.

**7. Group-eval / fair pick.** Real LLM verdict with a fairness panel + sanity checks
— a credible, defensible pick surface. Same ceiling as stage 5: archetype-fairness,
not EEO classes.

**8. Offer.** The offer DOES carry a `currency` field (`offer-finalize.ts:163`,
`offer/[token]/page.tsx:189`) so a USD figure can be *stored* and shown — that's
something. But there's no USD benchmarking behind it (offer-policy.ts has no currency
logic at all), the page defaults the symbol to `"CZK"` (`offer/[token]/page.tsx:189`),
and accept→onboarding is wired cleanly (`offer-finalize.ts:96-122`, CTA at
`offer/[token]/page.tsx:203-209`).

**9. Onboarding hand-off.** The token chain works: accept mints the onboarding run
(`offer-finalize.ts:103`), the candidate page fills it, answers surface on the
recruiter tab. Templates **are editable** — I can author a custom task list via
`coerceTasks` into a new template (`onboarding-store.ts:133-135`). So I *could* build
an insurance checklist. But the **default** is an office-party checklist
(`onboarding.ts:13-21`: contract, equipment, buddy, team intro) with a questionnaire
of t-shirt size + dietary needs (`onboarding.ts:25-32`) — no background check, no
license verification, no I-9/E-Verify, no fingerprinting. And the kicker for me:
**nothing feeds Workday.** The only "export" is `app/api/workspace/export/route.ts`,
which its own comment (`:7-21`) calls a *whole-database* JSON dump, not a per-tenant
or per-record feed and explicitly not an ATS/HRIS integration. There is no Workday
connector, no SCIM, no outbound webhook anywhere in `app/`. E-sign is honestly
flagged as a provider seam, not eIDAS (`onboarding.ts:1-6`).

## Findings

```yaml
- id: HR-INS-01
  journey: full-onboarding-lifecycle
  character: hr-insurance-head-ta
  cert_level: L1
  type: missing-feature
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: missing
  title: No ATS/HRIS (Workday) write-back — the only export is a whole-DB JSON dump
  expected: >
    The AI's output (shortlist, decision record, offer, hire) can export or write
    back into the external system of record (Workday Recruiting/HCM) — a connector,
    a structured per-record export, a webhook, or SCIM.
  got: >
    The single export is /api/workspace/export, which its own comment calls a
    whole-database kp-db-dump JSON (db-portability.dumpWorkspace), reads every table
    regardless of tenant, and is NOT a per-workspace or per-record feed. No Workday/
    Greenhouse/Lever connector, no SCIM, no outbound webhook exists. Everything the
    AI produces is stranded inside kp; a regulated req would have to be re-keyed into
    Workday by hand.
  evidence:
    - app/api/workspace/export/route.ts:7-21
    - app/_lib/db-portability.ts
  code_check: confirmed-absent
  l2_priority: low   # absence is fully visible in code; L2 can't conjure a connector
  verdict: open

- id: HR-INS-02
  journey: full-onboarding-lifecycle
  character: hr-insurance-head-ta
  cert_level: L1
  type: quality-gap
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Comp is hardcoded CZK / monthly / Czech market — no USD-annual US path
  expected: >
    A salary read in the right currency, cadence, and market for US insurance
    (USD, annual, US benchmark) with a basis.
  got: >
    salary_benchmarks.json declares currency:"CZK", market:"Czech Republic monthly
    gross", families software/data/product only — no insurance/actuarial/underwriting.
    The presentation layer is pinned: format.ts LOCALE="cs-CZ", APP_CURRENCY="CZK",
    and states "the app does not do FX." salary_band.py's plausibility ceiling is
    documented in CZK/month. A US annual insurance band cannot be produced; a
    CZK/monthly figure on a US role reads as broken.
  evidence:
    - data/salary_benchmarks.json:2-28
    - app/_lib/format.ts:6
    - app/_lib/format.ts:18
    - pipeline/jobfit/salary_band.py:20-33
  code_check: confirmed-absent
  l2_priority: med   # L2 should confirm the offer page can at least render a stored USD figure
  verdict: open

- id: HR-INS-03
  journey: full-onboarding-lifecycle
  character: hr-insurance-head-ta
  cert_level: L1
  type: missing-feature
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Taxonomy has no licensure/credential gate — a license is at best a skill keyword
  expected: >
    The role taxonomy + match reasoning can represent and GATE on a legally-required
    credential (FINRA Series 7/63, actuarial ASA/FSA, state producer/adjuster license,
    underwriting authority) as a pass/fail eligibility gate, by jurisdiction.
  got: >
    taxonomy.json carries only software/data/product/IT terms; "insurance" appears
    solely as a company_type keyword. No Series 7/63, ASA/FSA, underwriting, or state
    license term exists. The matcher can only ever treat a license as a skill bullet,
    never as the legal gate it is — so it can rank an unlicensed candidate over a
    licensed one for a Series-7 role.
  evidence:
    - data/taxonomy.json:4-168
    - data/taxonomy.json:150
  code_check: confirmed-absent
  l2_priority: med
  verdict: open

- id: HR-INS-04
  journey: full-onboarding-lifecycle
  character: hr-insurance-head-ta
  cert_level: L1
  type: trust
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Screening fairness is archetype/early-career only — no EEO/OFCCP adverse-impact read
  expected: >
    The screening/decision record carries a protected-class adverse-impact
    (four-fifths rule) sanity check, adequate for a US federal-contractor OFCCP/EEO
    review of a scoring/ranking tool.
  got: >
    The fairness gate shields early-career and unknown archetypes and fails closed —
    genuinely good engineering — but it is archetype-based, not protected-class based.
    No adverse-impact / four-fifths / EEO-1 / OFCCP logic exists in the pipeline; the
    sealed audit record documents the decision but carries no disparate-impact read.
    Legal would not certify this as the record for a regulated req.
  evidence:
    - app/_lib/screen-wave.ts:152-162
    - app/_lib/automation-fairness.ts
    - app/_lib/decision-attribution.ts:84-87
  code_check: confirmed-absent
  l2_priority: med
  verdict: open

- id: HR-INS-05
  journey: full-onboarding-lifecycle
  character: hr-insurance-head-ta
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: missing
  title: Default onboarding is generic-office — no background/license/I-9 pre-boarding
  expected: >
    Onboarding defaults (or a selectable industry preset) cover insurance pre-boarding:
    background check, state license verification, I-9/E-Verify, fingerprinting,
    credential collection.
  got: >
    DEFAULT_ONBOARDING_TASKS is contract/documents/equipment/accounts/buddy/firstday/
    intro; the entry questionnaire is preferredName/tshirtSize/dietaryNeeds/
    equipmentPrefs/emergencyContact/startDateConfirm — an office-party list. Templates
    ARE editable (coerceTasks → a custom template), so this is fixable by hand, but
    there is no industry preset and no background/license/I-9 affordance out of the box.
  evidence:
    - app/_lib/onboarding.ts:13-21
    - app/_lib/onboarding.ts:25-32
    - app/_lib/onboarding-store.ts:133-135
  code_check: present-but-missed   # editability exists; the regulated defaults do not
  l2_priority: low
  verdict: open

- id: HR-INS-06
  journey: full-onboarding-lifecycle
  character: hr-insurance-head-ta
  cert_level: L1
  type: confusion
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: low }
  dimension: trust
  title: Offer page hardcodes "CZK" fallback on the candidate-facing comp figure
  expected: The offer's stored currency drives the symbol; no Czech default leaks through.
  got: >
    The offer carries a currency field (offer-finalize.ts:163) so a USD figure can be
    stored, but the public offer page falls back to the literal "CZK" when currency is
    absent — a US candidate could see "CZK" on their offer letter.
  evidence:
    - app/offer/[token]/page.tsx:189
    - app/_lib/offer-finalize.ts:163
  code_check: present-broken
  l2_priority: low
  verdict: open
```

## Strengths (what NOT to touch)
- **Human-in-the-loop screening is genuinely well built**: dry-run preview that
  commits nothing, fail-closed fairness, optimistic CAS so a stale reject becomes a
  no-op, and a sealed, replayable per-decision audit record. (`screen-wave.ts:113-223`)
- **Honest auto/human attribution** that refuses to misattribute an unknown action to
  the machine — exactly the audit posture I want. (`decision-attribution.ts:84-87`)
- **Idempotent, CAS-guarded offer→Hired→onboarding chain** with no phantom transitions
  and a concrete on-page onboarding next-step. (`offer-finalize.ts:40-122`,
  `offer/[token]/page.tsx:203-209`)
- **Onboarding templates are editable** and the e-sign seam is *honestly labeled* as a
  provider hook, not falsely claimed as eIDAS. (`onboarding.ts:1-6`,
  `onboarding-store.ts:133-135`)
- **Strong render-boundary contracts** (score/timestamp/fraction invariants in
  `format.ts`) — the kind of discipline that survives a SOC 2 review.

## Per-journey verdict
**L1-conditional.** The lifecycle *thread* completes end to end with no dead-end and
real human-in-the-loop machinery — but four findings (no Workday write-back, CZK-only
comp, no licensure gate, no EEO/OFCCP adverse-impact) are each independently
adoption-blocking for a US regulated carrier. Structurally the flow is sound; the
*fit* is bank-shaped and Czech-shaped. Carry HR-INS-01..04 forward to L2.

## Grounding score per AI surface
Inputs that should reach each prompt: {real CV, real JD, role/industry taxonomy,
market/industry comp, company size, jurisdiction, prior pipeline history, my own data}.

- **Match / shortlist** — grounding **4/8** (real CV ✓, real JD ✓, taxonomy ✓ *but
  wrong domain*, pipeline history ✓; industry comp ✗, size ✗, US jurisdiction ✗, my
  data ✗ — locked to one CZ workspace).
- **CV analysis / job-fit** — **4/8** (CV ✓, JD ✓, deterministic salary findings ✓
  *but CZK/CZ market*, soft signals ✓; industry comp ✗, size ✗, jurisdiction ✗, my
  data ✗).
- **Screening decisions** — **5/8** (CV-derived scores ✓, JD ✓, policy/config ✓,
  audit/attribution ✓, pipeline history ✓; EEO jurisdiction ✗, industry ✗, my data ✗).
- **Group-eval** — **4/8** (shortlist ✓, JD ✓, fairness panel ✓, sanity ✓; protected-
  class jurisdiction ✗, industry ✗, comp ✗, my data ✗).
- **Overall grounding: ~4.3/8 (≈0.54).** Good machinery, fed bank/Czech context the
  Character cannot override.

## Estimated time-saved + adopt?
**Confidence: medium (L1, code-grounded; no live LLM run).** *If* the four fit gaps
were closed, the screening + sealed-record machinery plausibly takes screening toward
the research floor (~12-16 hrs/hire, a 60-70% cut) AND produces the decision
documentation as a byproduct — the expensive part for a federal contractor. **As it
stands today: net-negative.** Comp must be redone by hand (wrong currency/market),
licensure checked manually (not in taxonomy), the OFCCP file built separately (no
adverse-impact), and *everything re-keyed into Workday* (no write-back). For a
regulated req that's more work, not less. **Adopt: NO, not for licensed/regulated
roles today.** Pilot-worthy only on non-licensed home-office roles once a USD path and
a Workday export exist.

## First-person Character review
Look — the bones are better than most of what procurement drags across my desk. The
screening flow actually has a human in the loop, a preview that commits nothing, and a
tamper-evident record that names who decided what. I respect that; it's the part most
vendors fake. But this product was built for a Czech bank, and it shows in the three
places that matter most to me. Comp comes out in crowns per month — I can't put that
in front of a US insurance hire. The role brain has no idea what a Series 7 or an FSA
or a state adjuster license is, so it can't gate on the one thing that legally decides
who's eligible. And its "fairness" protects juniors, not protected classes — my legal
team needs an adverse-impact read before this touches a real req, and there isn't one.
Then the dealbreaker that sits over all of it: there's no way to get any of this into
Workday. The only export is a dump of the whole database. That's not an integration,
that's a backup. Onboarding's the same story — editable, which I appreciate, but the
default is t-shirt sizes when my industry needs background checks, license
verification, and I-9. Would I tell a peer at another carrier to look? Only with the
caveat: "great screening engine, completely wrong shape for a US regulated employer —
watch it if they ship USD comp, a licensure gate, EEO math, and a Workday connector."
Until then it's a beautiful island, and I don't hire onto islands.
