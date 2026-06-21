---
run: 2026-06-20-hr20-onboarding
character: hr-saas-peopleops
character_name: Daniel Okonkwo
journey: full-onboarding-lifecycle
cert_level: L1
language: en
verdict: L1-conditional
date: 2026-06-20
---

# L1 — Daniel Okonkwo (Senior People Ops, remote-first SaaS scale-up, ~400 ppl, US/remote) × full-onboarding-lifecycle

> Method: theoretical walk over the code-derived surface model (no browser). The
> central question at every AI stage: **does the output fit MY world — US/remote
> SaaS, market-band + equity + geo comp, EEOC, async cross-tz onboarding — or is
> it bank-shaped and Czech-shaped?** Spot-verified the four anchors most load-
> bearing for my fit lens before judging: `data/taxonomy.json`,
> `data/salary_benchmarks.json` + `pipeline/jobfit/salary_band.py`,
> `app/_lib/onboarding.ts` + `onboarding-store.ts`/`onboarding-candidate.ts`,
> `app/_lib/screen-wave.ts` + `decision-attribution.ts` + `consent.ts` +
> `AiDisclosure.tsx` + `timezone.ts`, and `pipeline/jobfit/match_reasoning.py` +
> `offer-finalize.ts`/`offers-store.ts`.

## Per-stage walkthrough (in character)

**1. Post / ingest the role.** The taxonomy (`data/taxonomy.json`) is, to my
relief, genuinely tech-shaped: software_engineering / data_ai / product_project
families, plus the modifiers I actually live in — `company_scaleup`,
`company_remote`, `company_equity` (`taxonomy.json:151,155,156`). That's better
fit for *my* roles than I feared from a "bank seed." The catch: every term is
carries Czech surface forms and the only seeded *jobs* are a Czech bank's; I can't
truly bring my own corpus (workspace-lock, a known ceiling). For an eng-heavy SaaS
shop, the role graph is usable; for my GTM/People reqs it thins out fast.

**2. AI match / shortlist.** Two things stop me cold. The system persona is
hardcoded *"a precise technical recruiter for the **Czech tech market**"*
(`match_reasoning.py:24`) — every rationale I'd hand a hiring manager is written
through a Czech-market lens I can't change. And the prompt is fed **structured
fields only** — `skills[:25]`, archetype, seniority, years, education
(`match_reasoning.py:36-43`) — never the real CV text. "Names a concrete fact from
*this* CV" can't be true when the model never sees the CV. Good machinery, thin
context.

**3. CV analysis / salary read.** The salary benchmark file is **CZK monthly
gross, Czech market, hardcoded** (`salary_benchmarks.json:2-5`) and the plausibility
ceiling is pinned to CZK/month (`salary_band.py:33`). There is no USD, no annual
basis, no geo adjustment toward a US remote band. For me this number is not just
wrong, it's a different planet. The basis is real and honest — it's just the wrong
market, with no override.

**4. Applicants in the pipeline.** Consent is GDPR-shaped and solid:
12-month TTL, expiry lifecycle, anonymize-on-expiry that *keeps* non-PII scoring
signal (`consent.ts:10,33,137`). It's a clean GDPR story — but it's the *EU* story.
Nothing here speaks to EEOC adverse-impact (the regime my Legal team actually
invokes for a US workforce).

**5. Screening decisions.** This is the strongest stage for my trust lens.
`runScreenWave` has a real **human-in-the-loop**: a dry-run *preview* computes the
full verdict and commits nothing — no status flip, no email, no audit
(`screen-wave.ts:111-117,189-193`); the recruiter re-runs to apply. The fairness
gate **fails closed** — early-career and any unknown archetype are shielded
(`screen-wave.ts:152-162`). Every auto-reject seals a tamper-evident record
(`screen-wave.ts:215-223`) and attribution is honestly three-state (auto/human/
unknown, never defaulting to "machine", `decision-attribution.ts:84-87`). That's
defensible machinery. What's *missing* for me: the fairness lens is archetype-
(early-career) based, not the **4/5ths adverse-impact** statistic EEOC asks for,
and there's no surfaced disparity check.

**6. Schedule + prep.** Genuinely good for a remote-first shop: slots are absolute
instants rendered in the candidate's own browser zone, with a zone label so "16:00
(GMT+2)" can't be misread, and the confirm captures the candidate's IANA zone for
the recruiter side (`timezone.ts:16,42-61`). This is the one place the build clearly
designed for my distributed reality.

**7. Group-eval / fair pick.** Present (`group-eval-run.ts`, `automation-fairness.ts`,
`sanity-checks.ts` per the surface map) with a fairness + sanity layer; usable for a
defensible pick. (Quality of the prose is an L2 judgment.)

**8. Offer.** The offer carries **only `currency` + `salary`** in the data model
(`offers-store.ts:32-33,82-83`) and the candidate page renders a single number with
`?? "CZK"` as the fallback currency (`offer/[token]/page.tsx:185-191`). Grep for
equity/options/RSU/bonus/total-comp in the offer model: **nothing**. For a SaaS
offer where equity is half the package, a bare base in CZK is not an offer I'd send.

**9. Onboarding hand-off.** The chain is clean and I respect it: accept →
the offer token *doubles* as the onboarding link → an inline CTA on the page (not
just an email) → pre-boarding questionnaire → answers mirror to the recruiter
timeline (`offer-finalize.ts:108-110`, `offer/[token]/page.tsx:203-209`,
`onboarding-candidate.ts:30-69`). The default task list is generic-office (contract,
documents, equipment, accounts, buddy, first-day, intro — `onboarding.ts:13-21`) —
no IP assignment, no equity acceptance, no 30/60/90 — BUT templates are fully
editable up to 40 tasks via `createTemplate`/`coerceTasks` (`onboarding-store.ts:131`,
`onboarding.ts:41`), and a "buddy" task already ships. So I *can* shape it to my
world; I just start from an office default. The e-sign is honestly flagged as a
provider seam, audit-stamped, not eIDAS (`onboarding.ts:1-6`) — a ceiling named, not
hidden, which I'd keep.

## Findings

```yaml
- id: hr20-onb-01
  journey: full-onboarding-lifecycle
  character: hr-saas-peopleops
  cert_level: L1
  type: quality-gap
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Offer surfaces a single salary number (base only, CZK-defaulted) — no equity / total comp / geo band
  expected: >
    A SaaS offer shows TOTAL comp — base + equity/options + a geo-adjusted band
    with a basis. Daniel can't send an offer that hides half the package.
  got: >
    The offer data model has only `currency` + `salary`; the candidate offer page
    renders one number with `?? "CZK"` fallback. No equity/options/RSU/bonus/
    total-comp field exists anywhere in the offer store or page.
  evidence:
    - "app/_lib/offers-store.ts:32-33"
    - "app/_lib/offers-store.ts:82-83"
    - "app/offer/[token]/page.tsx:185-191"
  code_check: confirmed-absent
  l2_priority: low   # the absence is fully visible in code; no live run needed
  verdict: >
    Embarrassed-to-send → blocker per severity arbitration (senior-quality on the
    headline offer output). The single biggest misfit for a SaaS comp philosophy.

- id: hr20-onb-02
  journey: full-onboarding-lifecycle
  character: hr-saas-peopleops
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Match-reasoning persona hardcoded to "Czech tech market"; prompt never sees the real CV
  expected: >
    Shortlist reasoning framed for MY market and grounded in this candidate's
    actual CV facts.
  got: >
    System prompt is hardcoded "a precise technical recruiter for the Czech tech
    market" with no market parameter; the reasoning context is structured fields
    only (skills[:25], archetype, seniority, years, education) — the CV rawText
    never reaches the prompt.
  evidence:
    - "pipeline/jobfit/match_reasoning.py:24"
    - "pipeline/jobfit/match_reasoning.py:36-43"
    - "pipeline/jobfit/match_reasoning.py:102-112"
  code_check: confirmed-absent
  l2_priority: high   # confirm whether resulting prose still names concrete CV facts
  verdict: >
    Wrong-domain framing + thin grounding on the headline AI output = major
    minimum. The reasoning can't "name a fact from this CV" it never received.

- id: hr20-onb-03
  journey: full-onboarding-lifecycle
  character: hr-saas-peopleops
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Salary read is CZK-monthly-gross, Czech-market, hardcoded — no USD / annual / geo basis
  expected: >
    A comp read credible for MY market (US remote SaaS): a USD annual band with a
    geo basis, or at minimum a configurable market.
  got: >
    salary_benchmarks.json is "CZK monthly gross, Czech Republic, technology
    roles"; the plausibility ceiling is pinned to CZK/month. No market override.
  evidence:
    - "data/salary_benchmarks.json:2-5"
    - "pipeline/jobfit/salary_band.py:24-33"
  code_check: by-design   # honest basis, but the wrong market with no override
  l2_priority: low
  verdict: >
    The number has a basis (a strength) but it's the wrong jurisdiction and not
    overridable → major for a US Character. Note the workspace-lock ceiling.

- id: hr20-onb-04
  journey: full-onboarding-lifecycle
  character: hr-saas-peopleops
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: med, reachability: high, trust_erosion: high }
  dimension: trust
  title: Screening fairness is archetype-shielding (GDPR-shaped); no EEOC adverse-impact / 4-5ths lens
  expected: >
    Screening Daniel can defend to US Legal: a human gate (present), AI disclosure
    (present), AND an adverse-impact (4/5ths) check or disparity surface for a US
    workforce.
  got: >
    Strong human-in-loop preview + fail-closed early-career shield + sealed audit
    record + GDPR consent lifecycle — but the fairness gate is archetype-based, not
    a protected-class adverse-impact statistic; no disparity check is surfaced. The
    whole compliance framing is EU (GDPR), not US (EEOC).
  evidence:
    - "app/_lib/screen-wave.ts:152-162"
    - "app/_lib/screen-wave.ts:215-223"
    - "app/_lib/consent.ts:10-58"
  code_check: confirmed-absent   # (the EEOC-specific lens; the machinery itself is present & strong)
  l2_priority: med
  verdict: >
    The human-in-loop + audit machinery is genuinely strong (see strengths); what's
    absent is the US-jurisdiction lens my Legal team invokes → major (a compliance
    Character could rate this higher for a US high-risk use).

- id: hr20-onb-05
  journey: full-onboarding-lifecycle
  character: hr-saas-peopleops
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: missing
  title: Onboarding defaults are generic co-located office; editable but no SaaS/remote preset (IP, equity-accept, 30/60/90)
  expected: >
    A remote-SaaS-shaped default: IP/invention assignment, equity-grant acceptance,
    async buddy, a 30/60/90 plan.
  got: >
    DEFAULT_ONBOARDING_TASKS is office-shaped (contract, documents, equipment,
    accounts, buddy, first-day, intro). No IP/equity/30-60-90. BUT templates are
    fully editable (createTemplate → coerceTasks, up to 40 tasks) and a buddy task
    already ships — so it's a starting-point gap, not a lock.
  evidence:
    - "app/_lib/onboarding.ts:13-21"
    - "app/_lib/onboarding.ts:41-56"
    - "app/_lib/onboarding-store.ts:131-153"
  code_check: by-design   # editability is intentional; the SaaS preset is what's missing
  l2_priority: low
  verdict: >
    Editable, so not a blocker to the job — downgraded to minor. The buddy task +
    editability are a real fit win; the missing SaaS preset is the only gap.

- id: hr20-onb-06
  journey: full-onboarding-lifecycle
  character: hr-saas-peopleops
  cert_level: L1
  type: confusion
  severity: minor
  impact: { frequency: low, reachability: high, trust_erosion: low }
  dimension: clarity
  title: Offer page currency falls back to a literal "CZK" string when unset
  expected: A missing currency shouldn't silently print "CZK" to a US candidate.
  got: 'offer page renders `offer.currency ?? "CZK"` as the unit label.'
  evidence:
    - "app/offer/[token]/page.tsx:189"
  code_check: present-broken
  l2_priority: low
  verdict: A cosmetic-but-revealing Czech default leaking into a US-facing surface.
```

## Strengths (what NOT to touch)

- **Screening human-in-the-loop is real, not a checkbox.** Dry-run preview commits
  nothing (`screen-wave.ts:189-193`), the fairness gate fails *closed* on unknown
  archetypes (`:152-162`), and every auto-reject seals a tamper-evident, replayable
  record (`:215-223`). For someone who distrusts black boxes, this is the part I'd
  trust most.
- **Attribution is honestly three-state** — auto/human/**unknown**, refusing to
  default an unrecognized action to "the machine" (`decision-attribution.ts:84-87`).
  That's exactly the accountability posture I need for an audit.
- **AI disclosure to candidates is wired everywhere** it matters — apply, quick-
  apply, schedule, offer, interview, devcase (`AiDisclosure.tsx`, used at
  `offer/[token]/page.tsx:328`, `schedule/[token]/page.tsx:20`, etc.). "AI assists,
  a human decides" stated to the candidate's face is my non-negotiable, and it's here.
- **Timezone-aware self-scheduling** (`timezone.ts:16,42-61`) — built for a remote,
  distributed candidate pool. The one stage clearly designed for my world.
- **Onboarding token chain + editable templates** — accept lands on a concrete
  next-step page, the questionnaire mirrors back to the recruiter, and I can reshape
  the checklist to our reality (`offer-finalize.ts:108-110`, `onboarding-candidate.ts`,
  `onboarding-store.ts:131`). The e-sign ceiling is named, not hidden.

## Per-journey verdict

**L1-conditional.** The end-to-end thread completes with no dead-end and the
trust/compliance/scheduling machinery is genuinely strong. But two findings sit on
the headline AI outputs my job depends on: a **blocker** (single-number, CZK-
defaulted offer with no equity/total-comp) and a **major** (Czech-market-locked,
CV-blind match reasoning), plus a major **comp-market** misfit and a major **EEOC**
gap. Those carry forward to L2; none is a structural dead-end, so the journey is
L2-eligible.

## Grounding score per AI surface

Scale = of {real CV, real JD, role/industry taxonomy, market/industry comp,
company size, jurisdiction, prior pipeline history, this Character's own data}.

- **Match / shortlist reasoning:** **3/8** — has JD requirements, role taxonomy,
  company-size modifier; **missing** real CV text, my market, my jurisdiction
  (hardcoded Czech), my data (`match_reasoning.py:24,36-75`).
- **CV analysis / salary read:** **4/8** — real CV + role taxonomy + size modifier
  + a comp *basis*; but the comp market/jurisdiction is hardcoded CZK
  (`salary_benchmarks.json:2-5`).
- **Screening:** **5/8** — real pipeline cohort + scores + audit + GDPR jurisdiction;
  missing US/EEOC jurisdiction lens and my data (`screen-wave.ts`).
- **Offer:** **2/8** — base salary + currency only; no equity, no geo, no market
  basis (`offers-store.ts:32-33`).
- **Onboarding (deterministic, not an AI surface):** editable, token-chained — fit
  is configurable, n/a for grounding.

**Overall grounding: ~3.5/8.** Solid machinery, repeatedly fed thin or wrong-domain
(Czech/CZK) context that I can't override.

## Estimated time-saved + adopt?

- **Estimate (medium confidence, offline-anchored to README US benchmarks):** the
  screening + onboarding *machinery* could plausibly take me from ~20–23 hrs
  screening/hire toward the <8 hr range, and onboarding setup from ~3–4 hrs to <1 hr
  via the editable template + candidate self-serve questionnaire — IF the AI outputs
  were in my market. As shipped, the **net saving is eaten** by re-fixing comp by
  hand, re-explaining the score to US Legal, and re-framing reasoning off a Czech
  persona. So: real *potential* saving, **not realized** for my world today.
- **Adopt? Not yet** — conditional. I'd pilot the screening-audit + scheduling +
  onboarding-chain in a heartbeat; I will not roll out offers or shortlists until
  comp shows total comp and the match/salary layer can be set to US/USD.

## First-person review (Daniel's voice)

"Honestly? More than I expected, and less. The bones are good — the screening flow
is the first 'AI hiring' tool I've seen that actually keeps a human on the trigger
and seals an audit row I could hand my counsel without flinching, and it tells the
candidate to their face that AI assisted and a person decided. That's my line, and
it's here. Scheduling speaks the candidate's time zone without me babysitting it,
and accept actually lands the new hire on a real next step instead of 'our People
team will be in touch.' I can reshape the onboarding checklist to our world — a
buddy task already ships.

But this thing was built for a Czech bank and it shows the moment money or market
enters the room. The shortlist reasoning is literally written as 'a recruiter for
the Czech tech market,' and it never even reads the CV — it scores a bag of skill
tags. The salary read is Czech crowns per month; for my US remote band it's noise.
And the offer? One number. No equity, no geo. In SaaS that's not an offer, that's a
base. I can't send that.

So would I tell a peer? I'd say: watch this team for the trust and compliance work —
that's the hard part and they nailed the posture. But it's not multi-market yet, the
comp model is a single salary line, and the matching is fed too thin to defend. For
*my* company I'd pilot the screening + scheduling + onboarding rails and hold the
offer and shortlist until comp goes total-comp and the market is configurable.
Promising platform, wrong default world."
