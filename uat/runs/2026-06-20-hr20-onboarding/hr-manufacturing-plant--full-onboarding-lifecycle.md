---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-manufacturing-plant
character_name: Greg Halvorsen — Plant HR Manager
cert_level: L1
language: en
surface_binding: [Jobs/JD Library, Match, Analyze, Pipeline, Decisions (screening), Schedule, Onboarding]
verdict: L1-conditional
date: 2026-06-20
---

# L1 — Greg Halvorsen (Plant HR Manager) · full-onboarding-lifecycle

> L1 theoretical pass over the code-derived surface model. No browser. Every
> finding carries `file:line` and a code cross-check. Central question for this
> Character: does each AI output fit **US industrial manufacturing — hourly +
> shift + union wage grids, low-document blue-collar applicants, I-9/OSHA/EEOC
> compliance** — or is it bank-shaped and Czech-shaped?

## In-character walkthrough (per stage)

**1. Post / ingest the role.** I'd open Jobs and post a "3rd-shift Machine
Operator." First problem before I type a wage: the role taxonomy
(`data/taxonomy.json`) is **100% knowledge-worker** — every term votes
`software_engineering` / `data_ai` / `product_project` (taxonomy.json:4-145).
There is no operator, material handler, welder, maintenance, forklift, or any
production/trades family. My req has nothing to land in. The company-type axis
even hard-codes `bank, banking, insurance` as enterprise signals
(taxonomy.json:150). This is a tool that has never seen a factory.

**2. AI match / shortlist.** The match-reasoning system prompt is literally *"You
are a precise technical recruiter for the **Czech tech market**"*
(`pipeline/jobfit/match_reasoning.py:24`) and the prompt context is
skills/seniority/roleFamily/yearsExperience only (match_reasoning.py:36-75). None
of my floor-predictive knock-outs — shift availability, 50-lb lift, valid lift
license, attendance, distance-to-plant — exist as inputs. My blue-collar
applicants, who have thin or no CV, get scored on a skills graph they'll never
populate. It would rank my best forklift driver last.

**3. CV analysis / job-fit + salary read.** The salary engine is **CZK monthly
gross**, three tech families only (`data/salary_benchmarks.json:1-28`), with a
plausibility ceiling pinned to "the top of the Czech tech market"
(`pipeline/jobfit/salary_band.py:25-33`). There is no hourly-wage concept, no
shift differential, no USD, no union grid. A monthly-gross band where my contract
says "$22.40/hr step 2 + $1.25 third-shift differential" is useless and faintly
insulting on the floor.

**4. Applicants in the pipeline.** Consent / AI-disclosure plumbing exists
(`app/_lib/consent.ts`, `app/api/pipeline/[id]/consent/route.ts`) — good. But
the candidate archetypes are `bau / student / career_switcher`
(`pipeline/jobfit/archetypes.json:3-53`) — a low-document hourly operator doesn't
map cleanly to any; he'd default to `bau` and then get penalized by the
common checklist's "at least 3 skills" / "languages" / "education level"
weighting (archetypes.json:55-59), which is exactly the CV-completeness penalty I
flag as a pet peeve.

**5. Screening decisions.** The machinery here is genuinely strong — preview/
commit, fail-closed fairness gate, optimistic CAS, a sealed tamper-evident
decision record, queued rejection comms (`app/_lib/screen-wave.ts:98-251`). But
the fairness gate keys on *archetype* (early-career), not on **EEOC protected
class / adverse-impact**, and the compliance framing across the build is **EU AI
Act / GDPR Art. 22** (per the journey + research digest), with **zero** EEOC,
OFCCP, or adverse-action-notice concept anywhere (grep of the repo for
`EEOC|OFCCP|adverse.?action|I-9|OSHA|drug.?screen` = no real hits). The
auto-reject seals a rationale, but it is not an **adverse-action record** my Legal
team could file in a US audit.

**6. Interview schedule + prep + rubric.** Rubric axes are generic knowledge-work
(`Technical depth, Problem-solving, Communication, Experience & fit, Motivation`)
plus an early-career BARS model (`app/_lib/interview-rubric.ts:26-43`,
`pipeline/jobfit/interview-rubrics.json`). Nothing for a hands-on trade — no
safety-mindedness, no mechanical aptitude, no "can you read a work order." Czech
display overlay is wired (interview-rubric.ts:58-71); a US overlay isn't relevant
but the axes still don't fit a press operator.

**7. Group-eval / fair pick.** Same engine, same inputs — inherits the
knowledge-worker taxonomy and the EU compliance frame. Not separately re-judged.

**8. Offer.** Offer currency defaults to **CZK** on the candidate page
(`app/offer/[token]/page.tsx:189`) and the offer is a single `salary` scalar — no
hourly rate, no step, no differential structure. Accept → onboarding chain itself
is **sound**: the accepted offer's token doubles as the onboarding link, surfaced
inline as a concrete next step (offer/[token]/page.tsx:194-209), with a deadline
countdown (`:230-238`).

**9. Onboarding hand-off.** The default checklist is **pure office**: "Send & sign
employment contract / collect ID, tax, bank details / **order laptop and
equipment** / create email & system accounts / assign an **onboarding buddy** /
first-day plan / team intro" (`app/_lib/onboarding.ts:13-21`). The pre-boarding
questionnaire is `preferredName, tshirtSize, dietaryNeeds, equipmentPrefs,
emergencyContact, startDateConfirm` (onboarding.ts:25-32). For a plant this is
missing the entire job: **I-9/E-Verify, drug screen, background check, physical/
lift test, OSHA safety orientation, badge + PPE issue**. It IS editable — tasks
are validated/bounded per-template (`coerceTasks`, onboarding.ts:41-56), so I can
build my own list — but I'm building the whole plant onboarding from scratch, the
app contributes nothing industry-aware, and the questionnaire fields look fixed
(`ENTRY_QUESTIONNAIRE_FIELDS` is a const tuple, onboarding.ts:25-32). The e-sign
seam (`markSigned`) is audit-stamped, not itself eIDAS/ESIGN — the build names
that ceiling honestly (onboarding.ts:1-6).

## Findings

```yaml
- id: HRMFG-OB-01
  journey: full-onboarding-lifecycle
  character: hr-manufacturing-plant
  cert_level: L1
  type: missing-feature
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Role taxonomy has no production/trades families — a manufacturing req has nothing to land in
  expected: A role taxonomy that can represent operator / material handler / welder / maintenance / forklift so an hourly req can be classified, matched, and ranked.
  got: Every taxonomy term votes software_engineering / data_ai / product_project; company signals hard-code bank/banking/insurance. No trades or production family exists.
  evidence: ['data/taxonomy.json:4-145', 'data/taxonomy.json:150']
  code_check: confirmed-absent
  l2_priority: low   # L1 alone is conclusive; live run can't conjure families that aren't there
  verdict: A blue-collar req can't be represented at all — the engine downstream (match, score, rubric) all inherit this.

- id: HRMFG-OB-02
  journey: full-onboarding-lifecycle
  character: hr-manufacturing-plant
  cert_level: L1
  type: quality-gap
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Comp is CZK monthly salary bands — no hourly wage, shift differential, or USD; useless against a union grid
  expected: An hourly wage anchored to a grid/market (USD), with shift differential and the schedule/DOL data as the basis.
  got: salary_benchmarks.json is CZK monthly gross, three tech families; salary_band.py ceiling is pinned to the Czech tech market; offer page defaults currency to CZK and carries a single salary scalar.
  evidence: ['data/salary_benchmarks.json:1-28', 'pipeline/jobfit/salary_band.py:25-33', 'app/offer/[token]/page.tsx:189']
  code_check: by-design
  l2_priority: low
  verdict: The headline comp number is wrong-currency, wrong-cadence, wrong-structure for my world — I'd never put my name on it.

- id: HRMFG-OB-03
  journey: full-onboarding-lifecycle
  character: hr-manufacturing-plant
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: missing
  title: Onboarding defaults are office-only — no I-9/E-Verify, drug screen, background, physical, OSHA orientation, badge/PPE
  expected: Default (or industry-template) onboarding tasks covering I-9/E-Verify, drug screen, background check, physical/lift test, OSHA safety orientation, badge + PPE issue.
  got: DEFAULT_ONBOARDING_TASKS = contract / collect ID-tax-bank / order laptop / email accounts / onboarding buddy / first-day plan / team intro. Questionnaire = preferredName, tshirtSize, dietaryNeeds, equipmentPrefs, emergencyContact, startDateConfirm.
  evidence: ['app/_lib/onboarding.ts:13-21', 'app/_lib/onboarding.ts:25-32']
  code_check: confirmed-absent
  l2_priority: med   # tasks are editable (coerceTasks) — L2 confirms I can fully rebuild the list; questionnaire fields look fixed
  verdict: Tasks are editable so it's not a dead-end, but the app contributes zero plant-onboarding knowledge; the questionnaire const looks non-extensible — confirm at L2.

- id: HRMFG-OB-04
  journey: full-onboarding-lifecycle
  character: hr-manufacturing-plant
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Match reasoning is hard-pinned to the "Czech tech market" and scores on a skills graph my low-document floor will never populate
  expected: Reasoning grounded in floor-predictive knock-outs (shift availability, lift/physical, license/cert, attendance) for a US manufacturing req; no CV-completeness penalty on a low-document population.
  got: match_reasoning.py system prompt = "precise technical recruiter for the Czech tech market"; context is skills/seniority/roleFamily/yearsExperience only; archetypes are bau/student/career_switcher with a common "≥3 skills / languages / education" checklist.
  evidence: ['pipeline/jobfit/match_reasoning.py:24', 'pipeline/jobfit/match_reasoning.py:36-75', 'pipeline/jobfit/archetypes.json:55-59']
  code_check: by-design
  l2_priority: med   # L2 confirms how the prose actually reads for a thin-CV hourly applicant
  verdict: Good machinery fed wrong-domain context + the exact CV-completeness penalty I distrust.

- id: HRMFG-OB-05
  journey: full-onboarding-lifecycle
  character: hr-manufacturing-plant
  cert_level: L1
  type: trust
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Compliance is EU-AI-Act/GDPR-framed with no EEOC/OFCCP/adverse-action record — wrong jurisdiction for a US auto-reject
  expected: An automated rejection that produces an EEOC/OFCCP-defensible adverse-action trail under US law.
  got: Fairness gate keys on early-career archetype (fail-closed) and the sealed record is GDPR/EU-AI-Act framed; repo has zero EEOC / OFCCP / adverse-action concept. Disclosure + human-in-loop + sealed rationale exist but are aimed at the wrong regime.
  evidence: ['app/_lib/screen-wave.ts:152-223', 'app/_lib/archetypes.ts:35-68', 'app/_lib/decision-attribution.ts:39-50']
  code_check: present-but-missed   # strong audit machinery EXISTS; it's just jurisdiction-mismatched, not absent
  l2_priority: med
  verdict: The bones of an auditable decision are here and impressive — they're just built for Brussels, not for OFCCP. Legal wouldn't accept it as-is.

- id: HRMFG-OB-06
  journey: full-onboarding-lifecycle
  character: hr-manufacturing-plant
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: senior-quality
  title: Interview rubric axes are generic knowledge-work — nothing for a hands-on trade (safety, mechanical aptitude, work-order reading)
  expected: Rubric competencies relevant to a production/maintenance role (safety mindset, mechanical aptitude, follows-procedure, attendance reliability).
  got: Rubric = Technical depth / Problem-solving / Communication / Experience & fit / Motivation, plus an early-career BARS model; no trade-specific axis.
  evidence: ['app/_lib/interview-rubric.ts:26-43', 'pipeline/jobfit/interview-rubrics.json']
  code_check: confirmed-absent
  l2_priority: low
  verdict: Usable-ish as generic axes, but a senior plant HR pro would rebuild it; not job-blocking.
```

## Strengths (what NOT to touch)

- **Accept → onboarding chain is genuinely solid.** The accepted offer's token
  doubles as the onboarding link, surfaced inline as a concrete next step with a
  declined/expired terminal state and a deadline countdown
  (`app/offer/[token]/page.tsx:194-238`). No dead-end here.
- **Screening decision machinery is senior-grade** — preview/commit, fail-closed
  fairness gate, optimistic CAS so a stale reject is a no-op, a sealed
  tamper-evident record, queued rejection comms that never silently ghost, and
  per-candidate comms-failure surfacing (`app/_lib/screen-wave.ts:98-251`). The
  *regime* is wrong for Greg, but the engineering is exactly what I'd want.
- **Single-source taxonomies** (archetypes.json, interview-rubrics.json read by
  BOTH Python and TS) mean extending to a new family/rubric is a data change, not
  a code rewrite (`app/_lib/archetypes.ts:1-23`, `app/_lib/interview-rubric.ts:1-15`)
  — the build is *structurally* extensible to manufacturing even though it ships
  none of it.
- **Onboarding tasks are editable + bounded** (`coerceTasks`, onboarding.ts:41-56)
  — I can build my own plant checklist; it's a blank slate, not a locked office one.
- **Honest seams.** The e-sign ceiling (`markSigned` is audit-stamped, not eIDAS/
  ESIGN) is named in the code itself (onboarding.ts:1-6) — a strength to keep.

## Grounding score per AI surface

Inputs scored: {real CV, real JD, role/industry taxonomy, market/industry comp,
company size, jurisdiction, prior pipeline history, this Character's own data}.

| AI surface | grounding | note |
|---|---|---|
| Match / shortlist reasoning | **2 / 8** | gets CV-derived skills + JD requirements; taxonomy is wrong-industry, comp absent, jurisdiction Czech, no shift/lift/physical inputs (match_reasoning.py:24,36-75) |
| CV analysis / salary read | **2 / 8** | extraction works; comp is CZK-monthly-tech, no hourly/grid/USD, no manufacturing market (salary_benchmarks.json:1-28, salary_band.py:25-33) |
| Screening decision | **3 / 8** | real pipeline history + sealed record + disclosure; jurisdiction EU-only, taxonomy wrong-industry (screen-wave.ts:152-223) |
| Interview prep / rubric | **2 / 8** | archetype-aware; axes generic knowledge-work, no trade relevance (interview-rubric.ts:26-43) |
| Onboarding (deterministic) | **1 / 8** | not LLM; defaults office-only, editable but industry-blind (onboarding.ts:13-32) |

**Overall grounding for Greg's world: ~2 / 8 (LOW).** The defect is uniform:
strong machinery fed bank-/Czech-/knowledge-worker context that his industry can't
override at the surfaces that matter (taxonomy, comp, jurisdiction).

## Per-journey verdict

**L1-conditional.** The thread *structurally* connects end to end (post → match →
analyze → pipeline → screen → schedule → offer → onboarding) with no dead-end or
re-entry loop, and the accept→onboarding hand-off is sound — so it's not L1-fail.
But it carries **two blockers** (no trades taxonomy; CZK-salary-not-hourly comp)
and **three majors** (office-only onboarding, Czech-tech match reasoning, EU-only
compliance) that put the *output* far below Greg's senior bar for every AI surface.
These are conclusive at L1 (you can't conjure a family or a wage grid the code
doesn't have); they carry forward, and L2 is only worth running to confirm how the
prose *reads* for a thin-CV hourly applicant and whether the questionnaire const
is truly non-extensible.

## Estimated time saved (with confidence)

**For Greg's actual high-volume hourly use case: roughly zero, possibly negative.**
The app can't auto knock-out on shift/lift/license, can't quote an hourly wage, and
ships no plant onboarding — so he re-does the screen by hand and builds onboarding
from scratch, on top of fighting a CV-completeness penalty that ranks his floor
backwards. **Confidence: high** (the gaps are structural and code-confirmed, not
latency/quality nuances L2 would reveal). The screening *automation* would save
real time IF it ran on his knock-outs — the engine is there, the inputs aren't.
**Adopt? No** — not for a manufacturing plant as-shipped.

## First-person Character review

> Look — somebody built a *serious* piece of recruiting software here. The
> screening engine is better than what we run today: it previews before it
> commits, it won't double-reject, it seals a record, it doesn't ghost the
> candidate. I'd kill for that machinery on my floor.
>
> But this tool has never set foot in a factory. It wants a LinkedIn and a
> skills graph; my material handlers apply on a kiosk and their best credential
> is "showed up every day for six years." It quotes me a *monthly salary in
> Czech crowns* — I run a union wage grid in dollars an hour with a shift
> differential, and there's no place to even put that. Onboarding thinks the
> hard part is ordering a laptop and asking your t-shirt size; my hard part is
> I-9, a drug screen, an OSHA orientation, and a badge before anyone touches a
> press. And the compliance is all GDPR and EU AI Act — my auditor is OFCCP, and
> "we sealed a rationale" isn't an adverse-action notice.
>
> The bones are extensible — the taxonomies are one shared file each, the
> onboarding list is editable — so this *could* be made to fit my world. But
> as-shipped it's a knowledge-worker, European, salaried tool, and I'd be
> rebuilding the parts that matter myself. I wouldn't adopt it for the plant, and
> I wouldn't tell a peer at another plant to either — not until it speaks hourly,
> shift, lift, and OSHA. I'd tell my buddy in *corporate IT recruiting* to look,
> though. That's who it's for. Not me.
