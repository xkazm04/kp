---
run: 2026-06-20-hr20-onboarding
character: hr-media-agency-talent
character_name: Jordan Reyes
journey: full-onboarding-lifecycle
cert_level: L1
language: en
verdict: L1-fail
date: 2026-06-20
---

# L1 — Jordan Reyes (Head of Talent, ~90-person creative/advertising agency, US/NYC) × full-onboarding-lifecycle

> Method: theoretical walk over the code-derived surface model (no browser). The
> central question at every AI stage: **does the output fit MY world — NYC creative
> agency, portfolios/reels as the real résumé, a heavy freelance/day-rate mix,
> craft + vibe fit, USD comp, contractor onboarding — or is it bank-shaped and
> Czech-shaped?** Spot-verified the anchors most load-bearing for my fit lens before
> judging: `data/taxonomy.json` (role families), `pipeline/jobfit/extractors.py` +
> `gemini.py` (does intake capture portfolio/reel links?), `pipeline/jobfit/match_reasoning.py`
> (does reasoning see the work?), `data/salary_benchmarks.json` + `salary_band.py`
> (comp basis), `app/apply/[id]/quick/QuickApplyForm.tsx` (intake fields),
> `app/_lib/onboarding.ts` + `offers-store.ts`/`offer/[token]/page.tsx` + `screen-wave.ts`.

## Per-stage walkthrough (in character)

**1. Post / ingest the role.** First thing I check: can this thing even hold a
creative role? The taxonomy (`data/taxonomy.json`) has exactly **three** role
families — `software_engineering`, `data_ai`, `product_project`
(`taxonomy.json` roles via `salary_benchmarks.json:6-28`; `ROLE_FAMILIES` derived
at `taxonomy.py:78`). Every single `match` term is a tech skill — Python, React,
Kubernetes, Scrum. There is **no designer, art director, copywriter, motion artist,
producer, or strategist** anywhere in the graph, and the fallback family is
`software_engineering` (`market_salary_cli.py:91`, `source.py:26`). My entire roster
routes to "software engineer." The job model does at least carry an
`employment_type` field (`jobs.py:117`) — a thin nod to freelance/contract — but the
role *vocabulary* is a tech org's. For a creative agency, the role graph is the
wrong sport.

**2. AI match / shortlist.** Two killers. The system persona is hardcoded *"a
precise technical recruiter for the **Czech tech market**"* (`match_reasoning.py:23`)
— every rationale is written through a Czech-tech lens with no parameter to change
it. Worse for me: the reasoning prompt is fed **structured tags only** — `skills[:25]`,
archetype, seniority, years, education (`match_reasoning.py:36-43`) — and *never* the
candidate's work. There is no portfolio, no reel, no link in the context at all. In
creative hiring **the work IS the candidate**; a "match" that scores a bag of
software icons and never looks at the craft is exactly the tool that ranked my best
art director last. This can't name a real piece of work because it never saw one.

**3. CV analysis / portfolio read.** The extractor reads **PDF/DOCX/TXT/MD only**
(`extractors.py:61-70`) — there is **no URL fetch**, so a Behance/Vimeo/personal-site
link is not ingestible as a source. The Gemini schema *does* carry a `link` field per
experience ("url to code/demo or null", `gemini.py:65`) — but it's captured passively
from CV text, never fetched or reasoned over, and it doesn't reach the match prompt
(stage 2). The salary read is **CZK monthly gross, Czech market, hardcoded**
(`salary_benchmarks.json:2-5`; schema pins `"currency":"CZK","period":"month"`,
`gemini.py:79-80`) with a plausibility ceiling fixed to CZK/month at 350k
(`salary_band.py:24-33`). For a NYC creative **day rate** (think $600–1,200/day) or a
$120k art-director salary, this is a different planet — and there's no USD, no annual,
no day-rate basis, no market override.

**4. Applicants in the pipeline.** The intake forms decide whether the work can even
enter. The quick-apply form captures **name, email, and yes/no knockout questions —
nothing else** (`QuickApplyForm.tsx:34-36,189-211`); there is **no portfolio / reel /
website field**. So my single most important artifact has no front door. AI disclosure
is present and honest (`AiDisclosure.tsx`, shown at `QuickApplyForm.tsx:228`), which I
respect — but it's protecting an intake that can't hold a portfolio.

**5. Screening decisions.** Credit where due — this is the strongest stage for my
trust lens, and it's genuinely good. `runScreenWave` has a real **human-in-the-loop**:
a dry-run *preview* computes the full verdict and commits nothing — no status flip, no
email, no audit (`screen-wave.ts:112-117,186-193`); the recruiter re-runs to apply.
The fairness gate **fails closed** — early-career and any unknown archetype are
shielded (`screen-wave.ts:152-162`). Every auto-reject seals a tamper-evident record
(`screen-wave.ts:215-223`). I'd trust this machinery. The catch for me: it's framed
for EU/GDPR, not US **EEOC** adverse-impact — but honestly, my screening signal is
broken upstream anyway, because the match score it ranks on never read the portfolio.

**6. Schedule + prep.** Timezone-aware self-scheduling exists (`timezone.ts`,
`schedule-slots.ts`) — fine for me; NYC is one zone and freelancers are local. The
prep/rubric (`interview-rubric.ts`) is generated off the same tech-role context, so
the rubric for "senior motion designer" would be derived from a software-role lens.
Usable as scaffolding, wrong as content.

**7. Group-eval / fair pick.** Present (`group-eval-run.ts`, `automation-fairness.ts`,
`sanity-checks.ts`) with a fairness + sanity layer — defensible machinery, but it's
ranking the same craft-blind scores. Prose quality is an L2 judgment.

**8. Offer.** The offer model carries **only `currency` + `salary`**
(`offers-store.ts:32-33,82-83`) and the candidate page renders a single number with
`?? "CZK"` as the currency fallback (`offer/[token]/page.tsx:185-191`). No day-rate vs
annual distinction, no project duration, no work-for-hire/IP terms. For a 6-week
freelance booking on a day rate, "one monthly-ish number in crowns" is not an offer I
can send. USD is technically storable in the currency string (a small mercy), but the
shape is W2-salary-only and the default leaks Czech.

**9. Onboarding hand-off.** The chain itself is clean and I respect it: accept → the
offer token *doubles* as the onboarding link → an inline CTA on the page (not just an
email) → questionnaire → answers mirror to the recruiter (`offer-finalize.ts:96-122`,
`offer/[token]/page.tsx:203-209`). But the content is a **salaried co-located office
ceremony**: default tasks are contract / documents / equipment / accounts / buddy /
first-day / team-intro (`onboarding.ts:13-21`) and the questionnaire is
preferredName / tshirtSize / dietaryNeeds / equipmentPrefs / emergencyContact /
startDateConfirm (`onboarding.ts:25-32`, rendered `onboarding/[token]/page.tsx:22-26`).
For a contractor I need an **NDA, an IP/work-for-hire assignment, Figma/Adobe seat
provisioning, a brand-immersion deck, and the first brief** — none ship. Templates
*are* editable up to 40 tasks (`coerceTasks`, `onboarding.ts:41-56`), so I can reshape
it; I just start from the wrong ceremony, and a t-shirt size for a 6-week contractor
is faintly absurd. The e-sign is honestly flagged as a provider seam, audit-stamped,
not eIDAS (`onboarding.ts:1-6`) — a ceiling named, not hidden, which I'd keep.

## Findings

```yaml
- id: hr20-onb-01
  journey: full-onboarding-lifecycle
  character: hr-media-agency-talent
  cert_level: L1
  type: missing-feature
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: missing
  title: No way to attach or ingest a portfolio/reel/site link — the primary artifact in creative hiring is invisible
  expected: >
    A creative candidate can attach a portfolio / reel / Behance / Dribbble /
    personal-site URL at intake, and the AI reasons about the WORK. In my world the
    portfolio IS the résumé.
  got: >
    The quick-apply form captures only name, email, and yes/no knockout questions —
    no portfolio/URL field. The CV extractor reads PDF/DOCX/TXT/MD only with no URL
    fetch, so a link is not an ingestible source. The Gemini schema has a passive
    per-experience `link` field captured from CV text, but it is never fetched and
    never reaches the match-reasoning prompt.
  expected_evidence_note: portfolio is the single most load-bearing input for this Character.
  evidence:
    - "app/apply/[id]/quick/QuickApplyForm.tsx:34-36"
    - "app/apply/[id]/quick/QuickApplyForm.tsx:189-211"
    - "pipeline/jobfit/extractors.py:61-70"
    - "pipeline/jobfit/match_reasoning.py:36-43"
    - "pipeline/jobfit/gemini.py:65"
  code_check: confirmed-absent
  l2_priority: low   # the absence is fully visible in code; no live run changes it
  verdict: >
    Without a portfolio path the core promise (a craft-aware shortlist) cannot be
    delivered for creative roles — the job cannot be done in my world → blocker.
    The #1 industry fit-gap.

- id: hr20-onb-02
  journey: full-onboarding-lifecycle
  character: hr-media-agency-talent
  cert_level: L1
  type: quality-gap
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Role taxonomy has no creative families — designers/copywriters/producers all route to "software_engineering"
  expected: >
    The role graph carries creative families (design, art direction, copy, motion/3D,
    production, strategy) so a creative req and a creative CV classify correctly.
  got: >
    Exactly three role families exist — software_engineering, data_ai,
    product_project — and every taxonomy `match` term is a tech skill. No creative
    role or skill exists; the fallback family is software_engineering. A motion
    designer's CV classifies as a software engineer.
  evidence:
    - "data/salary_benchmarks.json:6-28"
    - "pipeline/jobfit/taxonomy.py:78-80"
    - "pipeline/jobfit/market_salary_cli.py:91"
    - "data/taxonomy.json:5-145"
  code_check: confirmed-absent
  l2_priority: low
  verdict: >
    Mis-classifying every creative role as engineering corrupts matching, scoring,
    and comp at the root → blocker for a creative org (compounds finding 01).

- id: hr20-onb-03
  journey: full-onboarding-lifecycle
  character: hr-media-agency-talent
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Match-reasoning persona hardcoded "Czech tech market" and never sees the candidate's work
  expected: >
    Shortlist reasoning that reads like a creative director who watched the reel —
    naming actual work/range — framed for the NYC creative market.
  got: >
    System prompt hardcoded "a precise technical recruiter for the Czech tech
    market" with no market parameter; the reasoning context is structured tags only
    (skills[:25], archetype, seniority, years, education) — no portfolio, no work,
    no CV text reach the prompt.
  evidence:
    - "pipeline/jobfit/match_reasoning.py:23"
    - "pipeline/jobfit/match_reasoning.py:36-43"
    - "pipeline/jobfit/match_reasoning.py:102-112"
  code_check: confirmed-absent
  l2_priority: high   # confirm whether resulting prose names any concrete work
  verdict: >
    Wrong-domain framing + craft-blind grounding on the headline AI output = major
    minimum; for a creative read it's an icon tally, the exact thing I distrust.

- id: hr20-onb-04
  journey: full-onboarding-lifecycle
  character: hr-media-agency-talent
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Comp is CZK monthly gross, Czech market — no USD, no annual, no day-rate basis for freelance
  expected: >
    A comp read for the NYC creative market: a USD annual band for staff OR a USD
    day rate for freelance, each with a basis.
  got: >
    salary_benchmarks.json is "CZK monthly gross, Czech Republic, technology roles";
    the Gemini salary schema pins currency CZK / period month; the plausibility
    ceiling is fixed to CZK/month. No USD, no annual, no day-rate concept, no market
    override.
  evidence:
    - "data/salary_benchmarks.json:2-5"
    - "pipeline/jobfit/gemini.py:78-86"
    - "pipeline/jobfit/salary_band.py:24-33"
  code_check: by-design   # honest basis, but wrong market/period/basis, no override
  l2_priority: low
  verdict: >
    A basis exists (a strength) but it's the wrong currency, period, and engagement
    basis with no override → major. Day-rate freelance comp has no representation.

- id: hr20-onb-05
  journey: full-onboarding-lifecycle
  character: hr-media-agency-talent
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: missing
  title: Offer + onboarding are W2-salaried-shaped; no freelance/day-rate engagement or contractor pre-boarding
  expected: >
    A freelance/contract engagement representable end to end: day-rate or
    project-fee offer, project duration, and contractor onboarding (NDA, IP/
    work-for-hire, software seats, brand immersion, first brief).
  got: >
    The offer model carries only currency + salary (one number, ?? "CZK" fallback) —
    no day-rate/project/duration. Onboarding defaults are salaried-office
    (contract/documents/equipment/accounts/buddy/first-day/intro) and the
    questionnaire is preferredName/tshirtSize/dietaryNeeds/equipmentPrefs/
    emergencyContact/startDateConfirm. Templates ARE editable (up to 40 tasks), and
    the job model has an `employment_type` field — so it's reshapeable, not a hard
    lock, but every default assumes a salaried co-located W2.
  evidence:
    - "app/_lib/offers-store.ts:32-33"
    - "app/offer/[token]/page.tsx:185-191"
    - "app/_lib/onboarding.ts:13-32"
    - "pipeline/jobfit/jobs.py:117"
  code_check: by-design   # editability + employment_type exist; the freelance shape is what's missing
  l2_priority: low
  verdict: >
    Half my hires are contractors; a W2-salary-only offer+onboarding default with no
    day-rate/IP shape is a major misfit. Editable templates soften it from blocker.

- id: hr20-onb-06
  journey: full-onboarding-lifecycle
  character: hr-media-agency-talent
  cert_level: L1
  type: confusion
  severity: minor
  impact: { frequency: low, reachability: high, trust_erosion: low }
  dimension: clarity
  title: Offer page currency falls back to a literal "CZK" string when unset
  expected: A missing currency should not silently print "CZK" to a US candidate.
  got: 'offer page renders `offer.currency ?? "CZK"` as the unit label.'
  evidence:
    - "app/offer/[token]/page.tsx:189"
  code_check: present-broken
  l2_priority: low
  verdict: A cosmetic-but-revealing Czech default leaking onto a US-facing offer.

- id: hr20-onb-07
  journey: full-onboarding-lifecycle
  character: hr-media-agency-talent
  cert_level: L1
  type: missing-feature
  severity: minor
  impact: { frequency: low, reachability: high, trust_erosion: med }
  dimension: trust
  title: Screening fairness is archetype-shielding (GDPR-framed); no EEOC adverse-impact / 4-5ths lens for US hiring
  expected: >
    Screening I can defend to US counsel: human gate (present), AI disclosure
    (present), AND a protected-class adverse-impact (4/5ths) or disparity surface.
  got: >
    Strong human-in-loop preview + fail-closed archetype shield + sealed audit record,
    but the fairness gate is archetype-based, not a protected-class statistic; the
    framing is EU/GDPR. No disparity surface.
  evidence:
    - "app/_lib/screen-wave.ts:152-162"
    - "app/_lib/screen-wave.ts:215-223"
  code_check: confirmed-absent   # the machinery is present & strong; the EEOC lens is what's absent
  l2_priority: med
  verdict: >
    Downgraded to minor FOR ME — at a 90-person agency adverse-impact statistics
    aren't my daily lever and the human gate is genuinely strong; a US compliance
    Character would rate this higher.
```

## Strengths (what NOT to touch)

- **Screening human-in-the-loop is real, not theater.** The dry-run preview commits
  nothing — no status flip, no email, no audit (`screen-wave.ts:112-117,186-193`); the
  fairness gate fails *closed* on unknown archetypes (`:152-162`); every auto-reject
  seals a tamper-evident, replayable record (`:215-223`). If the score it ranked on
  could read a portfolio, this would be the part I trust most.
- **AI disclosure to candidates is wired into the intake** (`AiDisclosure.tsx`, shown
  at `QuickApplyForm.tsx:228`) — "AI assists, a human decides" stated to the
  candidate's face. That's a posture I respect even in an agency.
- **The onboarding token chain is clean** — accept lands on a concrete next-step page,
  not "our People team will reach out," and the questionnaire mirrors back to the
  recruiter (`offer-finalize.ts:96-122`, `offer/[token]/page.tsx:203-209`).
- **Templates are genuinely editable** (`coerceTasks`, up to 40 tasks,
  `onboarding.ts:41-56`) and the job model carries `employment_type` (`jobs.py:117`) —
  the bones to represent freelance/contractor onboarding exist, even if no creative
  preset ships.
- **The e-sign ceiling is named, not hidden** (`onboarding.ts:1-6`) — audit-stamped,
  not eIDAS, stated up front. I'd keep that honesty.

## Per-journey verdict

**L1-fail.** Not because the thread dead-ends — it completes end to end — but
because two findings sit at the *root* of my world and block the job structurally:
there is **no path to attach or reason over a portfolio** (the primary creative
artifact), and the **role taxonomy has no creative families**, so every designer,
copywriter, and producer mis-classifies as a software engineer before any AI even
runs. Those aren't quality polish — they mean the headline outputs (shortlist,
fit, comp) are about the wrong job. Per the rubric, a structural gap that blocks the
job is L1-fail; fix the portfolio intake + a creative taxonomy before this is L2-
worth-running for a creative org. (The trust/compliance machinery is strong and
should carry forward unchanged.)

## Grounding score per AI surface

Scale = of {real CV, **portfolio/work**, real JD, role/industry taxonomy,
market/industry comp, company size, jurisdiction, prior pipeline history}.

- **Match / shortlist reasoning:** **2/8** — has JD requirements + a (tech) role
  taxonomy and a size modifier; **missing** the portfolio/work, real CV text, my
  market, my jurisdiction (hardcoded Czech-tech) (`match_reasoning.py:23,36-43`).
- **CV analysis / comp read:** **3/8** — real CV text + role taxonomy + a comp
  *basis*; but the taxonomy is tech-only, the work-link is never fetched, and comp is
  hardcoded CZK/month (`gemini.py:65,78-86`, `salary_benchmarks.json:2-5`).
- **Screening:** **5/8** — real pipeline cohort + scores + sealed audit + GDPR
  jurisdiction; missing the US/EEOC lens and craft-aware scores (`screen-wave.ts`).
- **Offer:** **2/8** — base salary + currency only; no day-rate, no USD basis, no
  engagement type (`offers-store.ts:32-33`).
- **Onboarding (deterministic, not an AI surface):** editable, token-chained — fit is
  configurable; the default ceremony is salaried-office. n/a for grounding.

**Overall grounding: ~3/8.** Solid machinery, repeatedly fed the wrong domain
(tech/Czech/CZK) and — uniquely for me — **blind to the work itself**, with no
override.

## Estimated time-saved + adopt?

- **Estimate (low-to-medium confidence, offline-anchored):** my manual baseline is
  **~15–25 hrs of portfolio review per creative hire** (you *watch* the reels) plus
  day-rate benchmarking. As shipped, the tool can't read a portfolio and can't
  classify a creative role, so the craft-aware first pass that would buy back those
  hours **doesn't exist** — I'd still open every link myself, and now I'm also
  feeding a tool the wrong inputs. **Net time-saved ≈ 0** for the screening/match
  core; the only realized savings are downstream-deterministic (the onboarding
  token-chain + self-serve questionnaire could trim onboarding setup if I rebuild the
  checklist). So: real machinery, **no realized saving** for creative hiring today.
- **Adopt? No** — not for creative roles as shipped. I'd happily pilot the
  screening-audit + onboarding-chain rails for our small **salaried account/ops**
  hires; I won't put a single creative req through it until portfolios are ingestible,
  the taxonomy has creative families, and comp speaks USD day-rate/annual.

## First-person review (Jordan's voice)

"I wanted to like this. The screening flow is honestly the first 'AI hiring' thing
I've seen that keeps a human finger on the trigger and seals a record I could hand a
lawyer without sweating, and it tells the candidate to their face that AI helped and
a person decided. That's a real posture, and accept actually lands a new hire on a
next step instead of a black hole. I'd take those rails.

But this was built for a Czech bank's engineers, and in my world that breaks at the
front door. There's nowhere to drop a portfolio link — and in creative hiring the
reel *is* the résumé. The matcher scores a bag of software icons and never looks at
the work; it'd rank a tasteful art director under a mediocre one with a longer skills
list, which is exactly the mistake that's burned me before. Every one of my roles —
designer, copywriter, motion artist, producer — gets filed as 'software engineer,'
because those are the only kinds of jobs it knows. The salary read is crowns per
month; my freelancers work on USD day rates. And the offer is a single salaried
number — there's no day rate, no project duration, no work-for-hire. Half my hires
are contractors and this thing only believes in W2.

Would I tell a peer? I'd say: if you're a tech company, watch this team — the trust
and compliance work is the hard part and they nailed the posture. But if you hire
creatives or freelancers, it can't see your candidates yet. For my agency it's a no
until it can read a portfolio, knows what an art director is, and can write a day-rate
offer in dollars. Great bones, completely wrong world."
