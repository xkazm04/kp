---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-hospitality-regional
character_name: Khalid Al-Mansoori
role: Regional HR Director — Hotels & Hospitality (multinational chain, UAE/Dubai, ~5000 ppl)
cert_level: L1
language: en
verdict: L1-fail
date: 2026-06-20
method: theoretical / code-grounded (no browser, no server)
---

# L1 — Khalid Al-Mansoori · full-onboarding-lifecycle

> "I move people across a border into a job that is legally allowed to exist. The
> offer is the easy part — the visa is the job. So I'm not asking 'does the AI
> match a CV.' I'm asking: does it speak hospitality, does it quote a package in
> my currency, and does its onboarding know my hire can't legally start until the
> labour card clears?"

Fit lens for every stage: **hospitality role taxonomy · tax-free AED annual
package · MoHRE/PDPL compliance · government-processing onboarding (visa, labour
card, Emirates ID, residency, medical, attestation, accommodation).**

---

## Per-stage walkthrough (in character)

**1. Post / ingest the role.** I open Jobs and want a *Front Office Supervisor*
or *Chef de Partie*. The role model carries title/seniority/role_family +
must-have/nice-to-have skills — fine structurally. But role_family resolves
through `data/taxonomy.json`, and that graph is **entirely software / data /
product / IT-ops** (`python`, `react`, `data_scientist`, `scrum`, `sap`…). There
is no front-office, F&B, housekeeping, culinary, or revenue family. My hospitality
roles will be classified by `DEFAULT_FAMILY` = software_engineering or by stray
keyword votes — so everything downstream that keys off role_family is already
mis-framed before a single candidate is scored.

**2. AI match / shortlist.** The reasoning prompt's system role is literally
*"You are a precise technical recruiter for the Czech tech market"*
(`match_reasoning.py:23`). The context handed to the model is archetype, seniority,
role_family, skills, must-haves — a tech lens. A line-cook's "fit reasoning" will
talk about missing must-have *skills* against a tech taxonomy, not service
orientation, shift tolerance, or the languages this property floor needs. The
machinery is sound; the domain is wrong for me.

**3. CV analysis / job-fit + salary read.** This is where it breaks for my world.
The salary estimate currency **defaults to `"CZK"`** and period to **`"month"`**
(`pipeline.py:626-627`); the deterministic anchor bands are **CZK monthly gross,
Czech tech roles** (`data/salary_benchmarks.json:1-3`); the plausibility ceiling
is hard-coded **350,000 CZK/month** (`salary_band.py:33`); and even the market-
evidence payload keys are **`suggested_minimum_czk` / `suggested_maximum_czk`**
(`pipeline.py:665-666`) — CZK is baked into the field *names*, not just a default.
There is nowhere to express **a tax-free AED annual package with housing/flights/
allowances**. The number is not high or low to me — it is meaningless.

**4. Applicants in the pipeline.** Drawer/consent/AI-disclosure exist; structurally
fine. The AI-disclosure copy (`messages/en.json:494-498`) is jurisdiction-neutral
("a human reviews and makes every advance, offer, and rejection decision") + a
GDPR 12-month retention line — better than I feared; not EU-AI-Act-only theatre.

**5. Screening decisions.** `runScreenWave` (`screen-wave.ts:98+`) has a real
human-in-the-loop story: dry-run preview, fail-closed fairness gate, per-decision
rationale, a sealed tamper-evident audit record, and queued candidate comms with
per-row failure tracking. This is genuinely defensible. My only fit caveat: the
fairness shielding is archetype-based (early-career), not the protected-attribute
or quota framing I'd reason about under UAE norms — but it's adequate and not
EU-locked.

**6. Interview schedule + prep + rubric.** Slots/timezone/prep exist
(`schedule-slots.ts`, `timezone.ts`); rubric relevance again rides the tech
taxonomy. Workable for a corporate/skilled role, off for line-level hospitality.

**7. Group-eval / fair pick.** Present (`group-eval-run.ts`, fairness/sanity
checks). Structurally a strength; domain-blind like the rest.

**8. Offer.** The offers table DOES carry a per-offer `currency` column
(`offers-store.ts:32, 105, 146`) — so the offer layer itself is currency-agnostic.
But the upstream salary that fills it is CZK/month (stage 3), and the public offer
page **defaults the display to `"CZK"`** when currency is null
(`offer/[token]/page.tsx:189`) and shows a single monthly-style figure with no
package breakdown (`:185-192`). Accept lands cleanly on a concrete onboarding
next-step (`:203-209`) — that part is good.

**9. Onboarding hand-off.** Accept → Hired → `startRun` + `dispatchOnboarding`
(`offer-finalize.ts:102-110`) — the chain holds, no dead-end. The default task set
is generic-office: contract, ID/tax/bank, laptop, accounts, buddy, first-day,
team intro (`onboarding.ts:13-21`). **None of my legal-gate steps** — visa /
labour card / Emirates ID / residency / medical / attestation / accommodation. The
saving grace: templates are **editable** (`createTemplate` + `coerceTasks`,
`onboarding-store.ts:131-138`) so I *can* author a hospitality/visa checklist. The
pre-boarding entry questionnaire, however, is a **fixed const** (preferredName,
tshirtSize, dietaryNeeds, equipmentPrefs, emergencyContact, startDateConfirm —
`onboarding.ts:25-32`), with no field for passport/visa status — and an onboarding
that implies the hire can just start is wrong for any GCC employer.

---

## L1 findings

```yaml
- id: hr-hosp-onb-01
  journey: full-onboarding-lifecycle
  character: hr-hospitality-regional
  cert_level: L1
  type: quality-gap
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Salary/comp read is hard-coded CZK-monthly with no path to a tax-free AED annual package
  expected: A comp figure Khalid can act on for his market — AED, annual, package-framed (base + housing + flights + allowances), with a basis.
  got: currency defaults to "CZK" and period to "month" (pipeline.py:626-627); anchor bands are CZK/month Czech tech (salary_benchmarks.json:1-3); plausibility ceiling hard-coded 350000 CZK/month (salary_band.py:33); market-evidence keys are literally suggested_minimum_czk/suggested_maximum_czk (pipeline.py:665-666). No currency/market/period configurability reaches the prompt; no package concept exists.
  evidence: ['pipeline/jobfit/pipeline.py:626', 'pipeline/jobfit/pipeline.py:627', 'pipeline/jobfit/pipeline.py:665', 'pipeline/jobfit/pipeline.py:666', 'data/salary_benchmarks.json:2', 'pipeline/jobfit/salary_band.py:33']
  code_check: confirmed-absent
  l2_priority: high  # confirm the live salary read renders CZK/month and carries a CZK basis on any role
  verdict: For my world this comp output is not low or high — it is meaningless, and presented with a confident "basis" it actively misleads a GM.

- id: hr-hosp-onb-02
  journey: full-onboarding-lifecycle
  character: hr-hospitality-regional
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Role taxonomy + match-reasoning lens are tech/Czech-only — no hospitality role families
  expected: The taxonomy can represent front office, F&B, housekeeping, culinary, revenue, etc., and reasoning reads like a hotelier (service orientation, shift/visa reality, languages).
  got: data/taxonomy.json carries only software/data/product/IT-ops terms and three role families (software_engineering, data_ai, product_project); match_reasoning.py's system prompt is "a precise technical recruiter for the Czech tech market" (line 23) and the context is skills/archetype/role_family only. A hospitality role falls to DEFAULT_FAMILY or stray votes; the rationale is generic vs a tech taxonomy.
  evidence: ['data/taxonomy.json:4', 'data/taxonomy.json:6', 'pipeline/jobfit/match_reasoning.py:23', 'pipeline/jobfit/match_reasoning.py:24', 'pipeline/jobfit/match_reasoning.py:57']
  code_check: confirmed-absent
  l2_priority: high  # run match-reasoning on a hospitality-shaped role and judge the prose
  verdict: The machinery is good; it's pointed at the wrong industry. I'd be embarrassed to hand a GM a "fit" written by a Czech tech recruiter for a Chef de Partie.

- id: hr-hosp-onb-03
  journey: full-onboarding-lifecycle
  character: hr-hospitality-regional
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: missing
  title: Onboarding has no government-processing / legal-start gate; entry questionnaire is a fixed const
  expected: Onboarding that knows the hire can't legally start until visa + labour card clear — steps for visa, labour card, Emirates ID, residency, medical, attestation, accommodation; an editable questionnaire incl. passport/visa fields.
  got: DEFAULT_ONBOARDING_TASKS is generic-office (contract, ID/tax/bank, laptop, accounts, buddy, first-day, team intro) with no legal-gate step (onboarding.ts:13-21); ENTRY_QUESTIONNAIRE_FIELDS is a fixed const with no passport/visa field (onboarding.ts:25-32). MITIGATION: task templates are editable via createTemplate/coerceTasks (onboarding-store.ts:131-138), so the checklist is not locked — which is why this is major, not blocker.
  evidence: ['app/_lib/onboarding.ts:13', 'app/_lib/onboarding.ts:25', 'app/_lib/onboarding-store.ts:131', 'app/_lib/onboarding-store.ts:133']
  code_check: present-but-missed  # defaults are generic, but the template (not the questionnaire) is editable
  l2_priority: med
  verdict: I can hand-build my own checklist, but the questionnaire can't capture passport/visa, and nothing in the flow signals that a "Hired" person isn't yet legal to start. Editable ≠ fits my world out of the box.

- id: hr-hosp-onb-04
  journey: full-onboarding-lifecycle
  character: hr-hospitality-regional
  cert_level: L1
  type: trust
  severity: minor
  impact: { frequency: high, reachability: med, trust_erosion: med }
  dimension: trust
  title: Public offer page defaults compensation display to "CZK" and shows a single figure, not a package
  expected: An offer reads as a tax-free AED annual package with a breakdown; if currency is unknown, don't assert one.
  got: offer page hard-defaults the displayed currency to "CZK" when null (offer/[token]/page.tsx:189) and renders one salary figure with no allowance/housing/flight breakdown (:185-192). The offers store currency column IS per-offer (offers-store.ts:32) so the seam exists — only the default + the single-figure shape are wrong.
  evidence: ['app/offer/[token]/page.tsx:189', 'app/offer/[token]/page.tsx:185', 'app/_lib/offers-store.ts:32']
  code_check: present-broken  # currency seam exists; the CZK fallback + non-package shape are the defect
  l2_priority: med
  verdict: A candidate of mine seeing "CZK" on a Dubai offer would think it's a scam. The data model could carry AED — the page just assumes Czech.

- id: hr-hosp-onb-05
  journey: full-onboarding-lifecycle
  character: hr-hospitality-regional
  cert_level: L1
  type: confusion
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: low }
  dimension: trust
  title: Compliance/fairness framing fits EU/early-career, not MoHRE/PDPL or quota (Emiratisation) reasoning
  expected: Compliance story is jurisdiction-neutral or speaks to my regime (UAE labour law, PDPL, Nafis/Emiratisation quotas).
  got: AI-disclosure copy is jurisdiction-neutral + GDPR 12-month retention (en.json:494-498); fairness shield is archetype/early-career based (screen-wave.ts:156-161). Neither is EU-AI-Act theatre, but neither speaks to my regime; no quota-tracking concept exists.
  evidence: ['messages/en.json:496', 'messages/en.json:497', 'app/_lib/screen-wave.ts:156']
  code_check: by-design  # framing is deliberately neutral; the gap is "doesn't reach MY regime", not "wrong regime asserted"
  l2_priority: low
  verdict: Better than EU-only theatre, but it doesn't help me prove fairness to a MoHRE inspector or track an Emiratisation quota. Neutral, not mine.
```

## Strengths (what NOT to touch)
- **Screening is genuinely defensible** (`screen-wave.ts:98+`): dry-run preview,
  fail-closed fairness gate, per-row rationale, sealed tamper-evident audit
  record, and queued comms with per-candidate failure surfacing. Human owns the
  adverse decision. This clears my reliability floor.
- **Offer→Hired→onboarding chain has no dead-end** and is concurrency-safe
  (`offer-finalize.ts:40-110`): CAS-guarded accept, idempotent, accept lands on a
  concrete onboarding link (`offer/[token]/page.tsx:203-209`).
- **AI disclosure is jurisdiction-neutral, not EU-only theatre** (`en.json:496`).
- **Onboarding templates are editable** (`onboarding-store.ts:131-138`) — the door
  to a hospitality checklist is open even if the default isn't mine.
- **No silent success on screening** — every reject is audited and the candidate
  is notified, with failures named per row.

## Per-journey verdict
**L1-fail.** Two findings cap it: a **blocker** on comp (CZK-monthly is baked into
field names, not just defaults — there is no path to a tax-free AED package), plus
a **major** taxonomy/reasoning mismatch that makes every AI verdict bank/tech-
shaped for a hospitality workforce. The thread *completes* structurally, but the
headline AI outputs do not fit my industry, market, or jurisdiction — the exact
"good machinery fed wrong-domain context" the journey predicts. Fix comp +
taxonomy before this is L2-eligible for my world.

## Grounding score per AI surface
Of {real CV, real JD, role/industry taxonomy, market/industry comp, company size,
jurisdiction, prior pipeline history, this Character's own data}:

- **Match / shortlist reasoning** — grounding **3/8** (real CV, real JD, role
  family) — but the taxonomy + comp + jurisdiction are tech/Czech, and the system
  prompt hard-codes "Czech tech market" (`match_reasoning.py:23`).
- **CV analysis / job-fit + salary** — grounding **3/8** (real CV, real JD,
  company-type adjustment) — comp is CZK/month-locked (`pipeline.py:626`,
  `salary_benchmarks.json:2`); no industry/market/jurisdiction for hospitality-UAE.
- **Screening (screen-wave)** — grounding **5/8** (real pipeline cohort, match
  scores, config, prior history, audit) — the strongest surface; jurisdiction +
  industry framing still absent.
- **Overall grounding: ~3.7/8.** Strong CV/JD plumbing; **industry, market comp,
  and jurisdiction are systematically bank/Czech-shaped** for this Character.

## Estimated time-saved + adopt
- **Estimate:** for the *screening* step alone, the wave + pre-written rationale
  plausibly delivers the ~60–70% screening cut at volume (anchor: ~23 hrs/hire →
  ~8 hrs) **IF** the reasoning weren't tech-taxonomy mush for hospitality roles.
  Net for *Khalid today*: **near-zero usable time-saved** on his core roles,
  because he must mentally re-currency every salary and rewrite every onboarding
  task — the tool moves work onto his plate. **Confidence: medium** (L1; the
  screening machinery is real but unverified on a hospitality-shaped fixture).
- **Adopt?** **No** — not for his core hospitality hiring as-is. The screening
  engine is worth piloting on *corporate/skilled* roles once comp + taxonomy are
  industry-configurable.

## First-person Character review
"There's a real engine in here — the screening wave is the most honest piece of
recruiting automation I've seen in a demo: it previews before it acts, it shields
who it should, it keeps a tamper-evident record, and it doesn't ghost the people
it rejects. If a labour inspector asked me to justify a cull, I could.

But this product was built for a Czech bank, and it never stopped being one. It
quotes me salaries in *crowns per month* — the system literally has fields called
`suggested_minimum_czk`. My offers are tax-free AED packages with housing and
flights; a single monthly crown figure isn't wrong, it's *not even in my universe*.
Its 'fit reasoning' is written by 'a precise technical recruiter for the Czech tech
market' — so it judges my Chef de Partie against a software taxonomy and tells me
about missing 'must-have skills.' And its onboarding cheerfully assumes my new hire
can walk in on day one, when the truth is she can't legally start until her labour
card clears — there's no visa step, no labour card, no Emirates ID, no medical,
and the pre-boarding form asks her t-shirt size but not her passport status.

What's missing for *my* industry: a hospitality role taxonomy; a comp model that
speaks AED, annual, package; a government-processing onboarding spine; and a word
about MoHRE/PDPL. The templates being editable is the one olive branch — I could
hand-build my checklist — but a tool I have to re-localise on every screen has
moved the work onto me and taken the credit. Would I tell a peer? I'd tell my
counterpart in a Prague office to try it tomorrow. For Dubai, I'd say: 'good bones,
wrong country — call them back when it speaks dirhams and dates.'"
