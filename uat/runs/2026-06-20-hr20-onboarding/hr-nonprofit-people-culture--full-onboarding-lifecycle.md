---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-nonprofit-people-culture
character_name: Grace Mwangi
cert_level: L1
language: en
verdict: L1-conditional
---

# L1 — Grace Mwangi (People & Culture Lead, intl. nonprofit ~60, Nairobi HQ) × full-onboarding-lifecycle

> L1 only: judged over the code-derived surface model, no browser. Every finding
> carries a `file:line` and a `code_check`. Grace's lens throughout: does the AI
> output fit *my* mission-driven, distributed, DEI-first, tiny-budget world — or
> is it bank-shaped and Czech-shaped?

## Per-stage walkthrough (in character)

**1. Post / ingest the role.** "I want to post *Program Officer — Protection,
Goma* or *M&E Coordinator*." I open Jobs/Library. The role taxonomy
(`data/taxonomy.json`) is the engine that classifies my posting — and it is
*entirely* software/data/product: python, react, kubernetes, data_scientist,
product_owner. The only `role_family_votes` that exist are `software_engineering`,
`data_ai`, `product_project`. There is no program, M&E, protection, fundraising,
advocacy, logistics, or community-mobilization family anywhere. My core roles
don't exist in this system's worldview. (Strength: it *does* carry
`company_remote`, `company_public_sector`, `company_startup` modifiers — it knows
distributed/public-sector orgs exist, just not non-tech *roles*.)

**2. AI match / shortlist.** The reasoning prompt
(`pipeline/jobfit/match_reasoning.py:22-25`) opens: *"You are a precise technical
recruiter for the Czech tech market."* That is the system identity for every
shortlist reason I'd read. It reasons over `mustHave`/`niceToHave` *skills*,
`roleFamily`, `seniority` — a tech-skills frame. Genuine strength for my DEI lens:
the context explicitly elevates `potentialScore`, `learningSignals`,
`aspirations`, `transferableSkills`, and `skillProvenance` for early-career and
*career-switcher* archetypes (`:44-56`) — the engine *does* try to credit
non-linear paths. But the lens is "Czech technical recruiter," not "mission fit,"
and the families it can speak are tech-only, so the reason it writes for my
community organizer would be a tech-skills verdict in disguise.

**3. CV analysis / job-fit + salary read.** The comp read is the sharpest misfit.
`data/salary_benchmarks.json:2-4` declares `"currency": "CZK"`, `"market": "Czech
Republic monthly gross salary, technology roles, 2026"`, `"default_family":
"software_engineering"`. The only role families with bands are the same three tech
families. `pipeline/jobfit/salary_band.py:33` hardwires a
`SALARY_PLAUSIBILITY_CEILING = 350_000` CZK/month and the docstring says it
"bounds CZK/month specifically." Multipliers in `taxonomy.json:170-191` are all
Prague-ICT rationales (Kitalent, platy.cz, expats.cz). For a Goma field salary or
a London grant-writer there is no currency, no market, no sector grid, no family.
The offer page even defaults the unit to `"CZK"` (`app/offer/[token]/page.tsx:189`).

**4. Applicants in the pipeline + consent.** Solid GDPR machinery
(`app/_lib/consent.ts`): consent TTL, expiry states, outreach suppression for
expired/anonymized, PII scrubbing that *retains* non-identifying signal for
rediscovery. This is real and reusable. But it is framed as **GDPR data-processing
consent** (Recruitis/Sloneek defaults, `:9`) — not as **AI-use disclosure to the
candidate** (the EU AI Act / dignity transparency Grace cares about). The two are
different promises; the code delivers the former.

**5. Screening decisions.** Strong, and the best fit for my DEI fears:
`app/_lib/screen-wave.ts:8-13` auto-rejects only the bottom % that are *also*
below a match floor, and the fairness gate **fails closed** — `isFairnessProtected`
spares early-career/unclassifiable candidates from auto-reject. Every auto-decision
carries an audited rationale (`:20-35`) and the candidate gets a queued rejection
comm. Human-in-the-loop is preserved (it's a "first wave" the recruiter commits).
This is defensible. The gap: the protected class is "early-career archetype," a
tech-archetype notion — it doesn't know "lived-experience / non-credentialed"
as a protected dimension for *my* roles.

**6. Interview schedule + prep + rubric.** Not deeply audited at L1 (timezone
handling exists, `app/_lib/timezone.ts`) — carry to L2 for whether the rubric is
tech-role-shaped.

**7. Group-eval / fair pick.** Fairness + sanity-check scaffolding present
(`app/_lib/automation-fairness.ts`, `sanity-checks.ts`) — a strength; L2 to judge
the prose.

**8. Offer.** Accept lands on a concrete inline onboarding CTA
(`app/offer/[token]/page.tsx:203-209`), deadline countdown (`:230-238`), expired
dead-end handled (`:216-222`). Good, no dead-end. Currency default CZK noted above.

**9. Onboarding hand-off.** The token chain is clean: accepted-offer token →
onboarding run (`app/_lib/onboarding-candidate.ts:18-25`, idempotent `startRun`),
questionnaire exposed without leaking checklist/terms, answers mirror to the
recruiter timeline (`:61-66`). But the **content** is single-country office:
`DEFAULT_ONBOARDING_TASKS` (`app/_lib/onboarding.ts:13-21`) = contract, ID/tax/bank,
order laptop, create accounts, buddy, first-day plan, team intro. No safeguarding
sign-off, no distributed/remote-setup-across-countries, no mission immersion. The
questionnaire (`:25-32`) is `tshirtSize`, `dietaryNeeds`, `equipmentPrefs`,
`emergencyContact` — confirmed in the candidate page bindings
(`app/onboarding/[token]/page.tsx:23-24`). Tasks *are* editable per template
(`:13` comment + `coerceTasks` validation), so I could add safeguarding — but the
questionnaire field set is a frozen `as const` union (`:25-33`); I cannot add a
"safeguarding policy acknowledged" or "country of work" field. And
`app/_lib/workspace-lock.ts` locks to the default workspace, so bringing my own
org's data is itself bounded (known ceiling, journey-noted).

## Findings

```yaml
- id: HR20-GRACE-L1-01
  journey: full-onboarding-lifecycle
  character: hr-nonprofit-people-culture
  cert_level: L1
  type: missing-feature
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Role taxonomy has no nonprofit/program/M&E/fundraising/field families — her core roles don't exist
  expected: "Posting a Program Officer / M&E Coordinator / fundraising role classifies into a relevant role family that drives matching + reasoning."
  got: "role_family_votes across data/taxonomy.json offer only software_engineering, data_ai, product_project. Every term is a tech/office skill. No program, M&E, protection, advocacy, fundraising, logistics, community-mobilization family exists."
  evidence: ["data/taxonomy.json:5-168", "data/salary_benchmarks.json:6-28", "pipeline/jobfit/match_reasoning.py:60-66"]
  code_check: confirmed-absent
  l2_priority: high
  verdict: "Her primary roles cannot be represented; the matching engine has nothing to classify them as. Foundational, not cosmetic."

- id: HR20-GRACE-L1-02
  journey: full-onboarding-lifecycle
  character: hr-nonprofit-people-culture
  cert_level: L1
  type: quality-gap
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Salary read is hardwired CZK / Czech tech market / software_engineering default — useless and misleading for her market
  expected: "A comp read in her market + currency against a sector-relevant (NGO/Birches-grid) band, with a basis she can show a donor."
  got: "salary_benchmarks.json declares currency=CZK, market='Czech Republic ... technology roles', default_family=software_engineering; salary_band.py pins a CZK-only plausibility ceiling (350k/month). Multipliers are all Prague-ICT rationales. Offer page defaults unit to CZK."
  evidence: ["data/salary_benchmarks.json:2-5", "pipeline/jobfit/salary_band.py:25-33", "data/taxonomy.json:170-191", "app/offer/[token]/page.tsx:189"]
  code_check: confirmed-absent
  l2_priority: high
  verdict: "A salary number in CZK against a Prague tech band is worse than nothing for a Goma/London NGO hire — it's a wrong number with false authority."

- id: HR20-GRACE-L1-03
  journey: full-onboarding-lifecycle
  character: hr-nonprofit-people-culture
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: missing
  title: Onboarding default tasks + pre-boarding questionnaire are single-country office; no safeguarding, no distributed setup, no mission; questionnaire fields not extensible
  expected: "Onboarding covers (or is editable to) safeguarding sign-off, remote/distributed setup across countries, and mission immersion — non-negotiable for a child/vulnerable-population INGO."
  got: "DEFAULT_ONBOARDING_TASKS = contract/ID-tax-bank/laptop/accounts/buddy/first-day/team-intro. Questionnaire = preferredName/tshirtSize/dietaryNeeds/equipmentPrefs/emergencyContact/startDateConfirm, frozen as a const union (not extensible). Tasks editable; fields are not."
  evidence: ["app/_lib/onboarding.ts:13-33", "app/onboarding/[token]/page.tsx:23-24", "app/_lib/onboarding-candidate.ts:40-58"]
  code_check: present-broken
  l2_priority: med
  verdict: "Tasks can be re-typed to add safeguarding; the questionnaire schema cannot. For a safeguarding-mandated org, a day-zero gap she'd have to run off-platform."

- id: HR20-GRACE-L1-04
  journey: full-onboarding-lifecycle
  character: hr-nonprofit-people-culture
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Match reasoning identity is hardcoded 'precise technical recruiter for the Czech tech market' — wrong lens for mission/values fit
  expected: "Reasoning judges values fit, lived experience, and transferable skill for the mission — not a tech-skills verdict in a Czech frame."
  got: "match_reasoning.py _SYSTEM hardcodes the Czech-tech-recruiter persona; the context is a skills/roleFamily/seniority frame. (Mitigant: it does elevate potential/learning/transferable signals for early-career + career-switcher archetypes.)"
  evidence: ["pipeline/jobfit/match_reasoning.py:22-25", "pipeline/jobfit/match_reasoning.py:34-66"]
  code_check: present-broken
  l2_priority: high
  verdict: "Good machinery, wrong persona + tech-only vocabulary. The reason it writes for her community organizer is a credential/skills read in disguise."

- id: HR20-GRACE-L1-05
  journey: full-onboarding-lifecycle
  character: hr-nonprofit-people-culture
  cert_level: L1
  type: trust
  severity: major
  impact: { frequency: med, reachability: high, trust_erosion: high }
  dimension: trust
  title: Consent is GDPR data-processing consent, not AI-use disclosure to the candidate; AI screening lacks an explicit candidate-facing AI notice
  expected: "When AI screens/scores a candidate, the candidate is explicitly told AI was used (AI Act / dignity transparency) — distinct from data-processing consent."
  got: "consent.ts implements GDPR processing-consent (TTL, expiry, suppression, PII scrub) framed on Recruitis/Sloneek defaults; the screen-wave audits a rationale and queues a rejection comm, but there is no candidate-facing 'AI was used in this decision' disclosure in the consent/comms core."
  evidence: ["app/_lib/consent.ts:1-10", "app/_lib/consent.ts:44-58", "app/_lib/screen-wave.ts:8-13"]
  code_check: present-but-missed
  l2_priority: med
  verdict: "Downgrade-aware: real consent + audited human-in-loop exist (a strength). The specific AI-disclosure-to-candidate promise is not evidenced in code; confirm the comms templates at L2 before hardening to blocker."

- id: HR20-GRACE-L1-06
  journey: full-onboarding-lifecycle
  character: hr-nonprofit-people-culture
  cert_level: L1
  type: missing-feature
  severity: minor
  impact: { frequency: med, reachability: low, trust_erosion: med }
  dimension: trust
  title: No visible 'free / near-free' posture; multi-tenant lock means she can't bring her own org's data
  expected: "A tiny-budget nonprofit can use the tool without a per-seat enterprise commitment and on her own data."
  got: "workspace-lock.ts pins to the default (bank) workspace — she can't load her org's corpus (known ceiling). Cost posture is not judgeable from the lifecycle surfaces (Billing is a separate tab); flagged for where it is reachable."
  evidence: ["app/_lib/workspace-lock.ts:1", "uat/journeys/full-onboarding-lifecycle.md:140-142"]
  code_check: by-design
  l2_priority: low
  verdict: "Bounded by a known ceiling; not a fresh defect. Affects adoption, not completion. Re-judge cost at the Billing surface."
```

## Strengths (what NOT to touch)
- **Fairness-gated screening that fails closed** (`app/_lib/screen-wave.ts:8-13`) —
  early-career/unclassifiable candidates are protected from auto-reject; every
  auto-decision is audited with a rationale and a queued candidate comm. This is
  exactly the DEI-defensible, human-in-the-loop posture Grace needs.
- **Career-switcher / potential-aware reasoning context**
  (`pipeline/jobfit/match_reasoning.py:44-56`) — the engine *deliberately* credits
  transferable skills, learning signals, aspirations, and skill provenance for
  non-linear paths. The philosophy aligns with hers; the persona/taxonomy don't.
- **GDPR lifecycle done properly** (`app/_lib/consent.ts`) — anonymize-on-expiry
  that retains non-identifying signal, outreach suppression, codepoint-safe name
  masking. Reusable as-is.
- **No dead-ends across the spine** — accept → inline onboarding CTA → questionnaire
  → recruiter timeline mirror, with expired/declined states handled
  (`app/offer/[token]/page.tsx:194-222`, `app/_lib/onboarding-candidate.ts:18-66`).
- **Onboarding tasks are editable per template** (`coerceTasks`,
  `app/_lib/onboarding.ts:38-56`) — she *can* add a safeguarding task even if the
  questionnaire fields are frozen.

## Grounding score per AI surface
Inputs counted: {real CV, real JD, role/industry taxonomy, market/industry comp,
company size, jurisdiction, prior pipeline history, her own data}.

- **Match / shortlist reasoning** — `grounding 3/8`: real CV facts, real JD,
  prior pipeline history reach it; taxonomy is tech-only, comp/jurisdiction/size
  are bank-CZK or absent, her own data is locked out. (`match_reasoning.py:34-66`)
- **CV analysis + salary read** — `grounding 2/8`: real CV + real JD reach it;
  comp band is CZK/Czech-tech/`software_engineering`-default, taxonomy tech-only,
  no her-market/jurisdiction/size. (`salary_benchmarks.json:2-28`, `salary_band.py:25-33`)
- **Screen-wave decision** — `grounding 4/8` (best): match score, fairness class,
  audited rationale, pipeline context reach it; but the protected class is a
  tech-archetype notion and there's no candidate AI-disclosure. (`screen-wave.ts:8-35`)
- **Onboarding (deterministic, not LLM)** — n/a for grounding; content fit scored
  in HR20-GRACE-L1-03.

**Overall grounding: 3/8 (LOW for her industry).** The machinery is real and
well-built, but it is fed bank-/Czech-/tech-shaped context at nearly every AI
surface, and her own program/field/market data cannot reach the prompts at all.

## Per-journey verdict
**L1-conditional.** The lifecycle *spine* is structurally sound — no dead-ends,
real human-in-the-loop screening, a clean offer→onboarding token chain, and a
fairness/potential philosophy that genuinely aligns with Grace's. But two
**blockers** for her world (no nonprofit role families; CZK/Czech-tech-only comp)
and two majors (Czech-tech reasoning persona; office-only onboarding with a frozen
questionnaire) mean the AI output is bank-shaped and Czech-shaped end to end. She
could *click through* it; she could not *put her name on it* for her mission. Fix
the taxonomy + comp grounding before any L2 quality pass would be worth running.

## Estimated time-saved
**Net negative-to-neutral for Grace as shipped (medium confidence, L1 inference).**
The reusable onboarding template and the screening machinery could save real hours
*if* the content fit her world — but with tech-only taxonomy, CZK comp, and a
Czech-tech reasoning persona, she'd have to rewrite every shortlist reason, discard
every salary number, and rebuild onboarding for safeguarding/distributed setup.
That rewrite plausibly **exceeds** her own ~15–25 hrs/hire hand-reading. **Adopt?
No** at L1 — below the adoption threshold until the taxonomy + comp grounding open
to her sector. The screen-wave fairness gate and consent lifecycle are the parts
she'd *want* to keep.

## First-person review — Grace Mwangi
"I went in hopeful, honestly. The screening is the first AI hiring tool I've seen
that *protects* the unconventional candidate instead of quietly filtering them out
— it spares early-career and people it can't neatly classify, it logs why, and the
person gets told they were turned down. That's rare, and it's the values part I
fight for. The reasoning even tries to credit career-switchers and transferable
skills. So the *heart* of this is closer to mine than I expected.

But it was built for a bank in Prague, and it can't hide it. I can't even *post*
my roles — there's no such thing as a program officer or an M&E coordinator in its
world, only engineers and product managers. Every salary it would show me is in
Czech crowns against a tech grid; if I put a CZK number next to a field role in
Goma I'd lose the room. And onboarding starts with 'order a laptop' and asks the
new hire their t-shirt size — but never once mentions safeguarding, which for us is
a day-zero, sometimes-legal requirement, and I can't even add that field. It
assumes everyone walks into one office in one country.

Would I adopt it? Not today — for my world it's the right machine fed the wrong
fuel, and rewriting the fuel by hand would cost me more than my own reading does.
Would I tell a peer? I'd tell another nonprofit P&C lead: 'watch the screening
team — they clearly thought about fairness. But it's a bank tool; it doesn't know
our roles, our money, or safeguarding. Wait until it speaks our sector.'"
