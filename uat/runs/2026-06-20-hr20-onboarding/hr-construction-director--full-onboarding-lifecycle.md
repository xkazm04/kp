---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-construction-director
character_name: Ray Delgado — HR Director (field + office)
cert_level: L1
language: en
surface_binding: [Jobs/JD Library, Match, Analyze, Pipeline, Decisions (screening), Schedule, Offers, Onboarding]
verdict: L1-conditional
date: 2026-06-20
---

# L1 — Ray Delgado (HR Director, commercial GC) · full-onboarding-lifecycle

> L1 theoretical pass over the code-derived surface model. No browser. Every
> finding carries `file:line` and a code cross-check. Central question for this
> Character: does each AI output fit **US commercial construction — field trades
> + office, hourly + per-diem + prevailing wage, project-burst ramps, cert/
> license-driven hiring (OSHA, journeyman, CDL, lift), contractor-vs-W2,
> EEOC/OFCCP/I-9 compliance** — or is it bank-shaped and Czech-shaped?

## In-character walkthrough (per stage)

**1. Post / ingest the role.** I open Jobs to post "Journeyman Electrician — $40M
hospital fit-out, 6-month assignment, per-diem." Before I can type a wage, the
role taxonomy (`data/taxonomy.json`) is **100% knowledge-worker** — every term
votes `software_engineering`, `data_ai`, or `product_project` (taxonomy.json:4-145).
There is no electrician, operator, carpenter, superintendent, foreman, laborer,
or any trades/construction family. `ROLE_FAMILIES` is *derived* straight from the
benchmarks file (`pipeline/jobfit/taxonomy.py:78-82`), so the three IT families
are the entire universe — and the Gemini extractor is forced to pick one of them
(`pipeline/jobfit/gemini.py:35,432-435`). My req has nothing legitimate to land
in; an electrician gets stuffed into "software_engineering" or the default family
(taxonomy.py:80). The company axis even hard-codes `bank, banking, insurance`
(taxonomy.json:150). This tool has never been on a jobsite.

**2. AI match / shortlist.** The match engine inherits that taxonomy and the
"Czech tech market" framing. The thing that actually decides a trades hire — **does
he hold the ticket this job legally requires** (OSHA 30, journeyman/master
license, hot card, CDL, lift cert) — is not an input or a match driver anywhere.
My best hands have a thin one-page résumé and a fat stack of cert cards and three
foremen who'll vouch; the engine ranks on a skills graph they'll never populate,
so it ranks résumé polish over proven tickets — the exact résumé-centric matching
I distrust most. (Taxonomy/family grounding confirmed above; the reasoning prompt
shape mirrors the manufacturing peer's read of `match_reasoning.py`.)

**3. CV analysis / job-fit + salary read.** The salary engine is **CZK monthly
gross**, three tech families only (`data/salary_benchmarks.json:1-28`), currency
hard-coded `"CZK"` and market literally "Czech Republic ... technology roles"
(salary_benchmarks.json:1-5). `role_band()` returns **None** for any family it
doesn't recognize (`pipeline/jobfit/taxonomy.py:258-266`) — and a construction
trade is always unrecognized — so my electrician gets *no anchor band at all*, or
falls through to a tech default. The plausibility ceiling is pinned to "the top of
the Czech tech market" (`pipeline/jobfit/salary_band.py:25-33`). There is **no
hourly rate, no per-diem, no prevailing-wage (Davis-Bacon) concept, no USD**. A
monthly-gross CZK number against my "$48.50/hr journeyman scale + $110/day
per-diem" is worse than useless — it's the kind of number that gets a bid
mispriced.

**4. Applicants in the pipeline.** Consent / AI-disclosure plumbing exists
(`app/_lib/consent.ts`, `app/api/pipeline/[id]/consent/route.ts`) — good bones —
but it is explicitly **GDPR**: "GDPR data-processing consent," a 12-month
retention TTL, expiry sweeps (consent.ts:1-56). My exposure is **EEOC, OFCCP,
I-9/E-Verify, and W-2-vs-1099 misclassification** — none of which appears anywhere
in the product (repo grep for `I-9|E-Verify|EEOC|OFCCP|prevailing|per-diem|OSHA`
hits only my cohort's UAT files and one analytics file, never app code). There is
**no contractor-vs-employee classification field** — for a GC who runs both W-2
crews and 1099 subs, that's the single question that can end my career, and the
tool doesn't ask it.

**5. Screening decisions.** The machinery here is genuinely strong — preview/
commit dry-run, a fail-closed fairness gate, optimistic CAS so a stale reject is a
no-op, a sealed tamper-evident decision record, queued rejection comms that never
silently ghost (`app/_lib/screen-wave.ts:98-251`). But it auto-rejects the
**bottom match-score %** (screen-wave.ts:129-174) — a pure match cut, with no
concept of a **cert/license knockout** (you legally *cannot* hire an electrician
without the license; you legally *cannot* put an uncertified operator on a lift).
The fairness gate keys on *archetype* (early-career), not EEOC protected-class /
adverse impact (screen-wave.ts:152-166), and the sealed record is GDPR/EU-AI-Act
framed (`app/_lib/decision-attribution.ts:39-50`). The auto-reject seals a
rationale, but it is **not an EEOC/OFCCP adverse-action record** counsel could
file in a US audit — and it can reject a great hand on a thin résumé while staying
blind to whether he holds the one ticket the job requires.

**6. Interview schedule + prep + rubric.** Scheduling and prep are wired
(`app/_lib/schedule-slots.ts`, `interview-prep-run.ts`, `interview-rubric.ts`),
but the rubric axes are generic knowledge-work (Technical depth / Problem-solving
/ Communication / Experience & fit / Motivation). Nothing for a trade —
no safety mindset, no "can you read a set of plans / a work order," no hands-on
aptitude, no attendance/reliability. Timezone handling assumes desk scheduling;
my superintendent picks up at 5:45 a.m. before the gate opens.

**7. Group-eval / fair pick.** Same engine, same inputs — inherits the
knowledge-worker taxonomy and the EU compliance frame. Not separately re-judged.

**8. Offer.** Offer currency **defaults to CZK** on the candidate page
(`app/offer/[token]/page.tsx:189`) and the offer is a single `salary` scalar — no
hourly rate, no per-diem line, no prevailing-wage/fringe structure, no W-2-vs-1099
designation. Accept → onboarding chain itself is **sound**: the accepted offer's
token doubles as the onboarding link, surfaced inline as a concrete next step
(`app/offer/[token]/page.tsx:194-209`), with declined/expired terminal states and
a deadline countdown that turns coral inside 48h (`:216-238`).

**9. Onboarding hand-off.** The default checklist is **pure office**: "Send & sign
employment contract / collect ID, tax, bank details / **order laptop and
equipment** / create email & system accounts / assign an **onboarding buddy** /
first-day plan / **team intro meeting**" (`app/_lib/onboarding.ts:13-21`). The
pre-boarding questionnaire is `preferredName, tshirtSize, dietaryNeeds,
equipmentPrefs, emergencyContact, startDateConfirm` (onboarding.ts:25-32). For a
jobsite this misses the entire day-one job: **I-9/E-Verify, drug screen,
background check, OSHA safety orientation + site-specific safety, PPE/hard-hat/
boots issue, tool/equipment assignment, badge + jobsite access, site assignment,
cert-card verification on file**. It IS editable — `coerceTasks` validates/bounds
a per-template list (onboarding.ts:41-56) — so I can rebuild it, but the app
contributes zero construction knowledge and I'm authoring the whole thing; the
questionnaire fields are a fixed const tuple (`ENTRY_QUESTIONNAIRE_FIELDS`,
onboarding.ts:25-32), so "what's your t-shirt size" stays and "do you hold a valid
OSHA 30" can't be added there. The e-sign seam (`markSigned`) is honestly named as
audit-stamped, not eIDAS/ESIGN (onboarding.ts:1-6) — a ceiling the build owns.

## Findings

```yaml
- id: HRCON-OB-01
  journey: full-onboarding-lifecycle
  character: hr-construction-director
  cert_level: L1
  type: missing-feature
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Role taxonomy has no construction/trades families — a field req has nothing to land in, and the family enum is closed
  expected: A taxonomy that can represent electrician / operator / carpenter / laborer / foreman / superintendent / PM so a trades req can be classified, matched, and ranked.
  got: Every taxonomy term votes software_engineering / data_ai / product_project; company signals hard-code bank/banking/insurance. ROLE_FAMILIES is derived only from the 3 IT families in salary_benchmarks.json and the Gemini extractor is forced to emit one of them.
  evidence: ['data/taxonomy.json:4-145', 'data/taxonomy.json:150', 'pipeline/jobfit/taxonomy.py:78-82', 'pipeline/jobfit/gemini.py:35,432-435']
  code_check: confirmed-absent
  l2_priority: low   # L1 is conclusive — live run can't conjure a family the enum doesn't have
  verdict: A trades req can't be represented at all; match, score, rubric, and salary all inherit this miss.

- id: HRCON-OB-02
  journey: full-onboarding-lifecycle
  character: hr-construction-director
  cert_level: L1
  type: quality-gap
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Comp is CZK monthly salary bands — no hourly wage, per-diem, prevailing wage, or USD; trades families get no band at all
  expected: An hourly wage for the trade in the metro (USD), with per-diem and prevailing-wage (Davis-Bacon)/fringe basis on public jobs.
  got: salary_benchmarks.json is CZK monthly gross, market "Czech Republic technology roles", 3 tech families; role_band() returns None for any unrecognized (i.e. construction) family; plausibility ceiling pinned to the Czech tech market; offer page defaults currency to CZK with a single salary scalar.
  evidence: ['data/salary_benchmarks.json:1-28', 'pipeline/jobfit/taxonomy.py:258-266', 'pipeline/jobfit/salary_band.py:25-33', 'app/offer/[token]/page.tsx:189']
  code_check: by-design
  l2_priority: low
  verdict: The headline comp is wrong-currency, wrong-cadence, wrong-structure, or absent for my trades — I'd never put my name on it or bid against it.

- id: HRCON-OB-03
  journey: full-onboarding-lifecycle
  character: hr-construction-director
  cert_level: L1
  type: missing-feature
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: No cert/license knockout and no contractor-vs-W-2 classification — the two things that legally gate a construction hire
  expected: A required-cert/license knockout (OSHA 30, journeyman/master license, CDL, lift cert) that gates the match BEFORE résumé scoring, and a W-2-vs-1099 classification field on the candidate/offer.
  got: Screening is a pure bottom-match-% auto-reject with no required-credential concept; no OSHA/journeyman/CDL/lift fields exist; no employment-classification field anywhere in pipeline, offer, or onboarding (repo grep for I-9|E-Verify|prevailing|OSHA|journeyman hits only UAT/analytics files, never app code).
  evidence: ['app/_lib/screen-wave.ts:129-174', 'app/_lib/onboarding.ts:13-32', 'data/taxonomy.json:4-145']
  code_check: confirmed-absent
  l2_priority: low
  verdict: The app is blind to the legal gate (license) and to the misclassification risk (1099 vs W-2) that define my job; it would happily advance an unlicensed electrician and never flag the classification question that gets us sued.

- id: HRCON-OB-04
  journey: full-onboarding-lifecycle
  character: hr-construction-director
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: missing
  title: Onboarding defaults are office-only — no I-9/E-Verify, drug screen, OSHA orientation, PPE issue, site assignment, cert verification
  expected: Default (or industry-template) onboarding covering I-9/E-Verify, drug screen, background, OSHA safety + site-specific orientation, PPE/tool issue, badge/jobsite access, site assignment, cert-card on file.
  got: DEFAULT_ONBOARDING_TASKS = contract / collect ID-tax-bank / order laptop / email accounts / onboarding buddy / first-day plan / team intro. Questionnaire = preferredName, tshirtSize, dietaryNeeds, equipmentPrefs, emergencyContact, startDateConfirm (fixed const tuple).
  evidence: ['app/_lib/onboarding.ts:13-21', 'app/_lib/onboarding.ts:25-32']
  code_check: confirmed-absent
  l2_priority: med   # tasks editable via coerceTasks — L2 confirms a full rebuild; questionnaire fields look non-extensible
  verdict: Tasks are editable so it's not a dead-end, but the app contributes zero jobsite-onboarding knowledge and the questionnaire const can't take an OSHA/cert field; I'd author the whole thing myself.

- id: HRCON-OB-05
  journey: full-onboarding-lifecycle
  character: hr-construction-director
  cert_level: L1
  type: trust
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Compliance is GDPR/EU-AI-Act-framed with no EEOC/OFCCP/I-9 adverse-action record — wrong jurisdiction for a US contractor
  expected: An automated rejection that produces an EEOC/OFCCP-defensible adverse-action trail under US law; consent/retention framed to US recruitment, not GDPR.
  got: Consent module is explicit "GDPR data-processing consent" with a 12-month retention TTL; fairness gate keys on early-career archetype (fail-closed); sealed record is GDPR/EU-AI-Act framed; zero EEOC / OFCCP / I-9 / adverse-action concept in app code.
  evidence: ['app/_lib/consent.ts:1-56', 'app/_lib/screen-wave.ts:152-166', 'app/_lib/decision-attribution.ts:39-50']
  code_check: present-but-missed   # strong, real audit machinery EXISTS — it's jurisdiction-mismatched, not absent
  l2_priority: med
  verdict: The bones of an auditable, disclosed, human-in-the-loop decision are here and impressive — they're just built for Brussels, not OFCCP. Counsel wouldn't accept it for a US adverse-action file as-is.

- id: HRCON-OB-06
  journey: full-onboarding-lifecycle
  character: hr-construction-director
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: senior-quality
  title: Match reasoning ranks résumé polish over tickets — Czech-tech-framed, blind to certs/hours-on-the-tools/references
  expected: Reasoning that leads with the legally-required ticket and proven hours/references for a trades hire on a thin-CV population; no CV-completeness penalty.
  got: Match inherits the IT taxonomy + "Czech tech market" framing and scores on a skills graph; certs/licenses/hours-on-tools/references are not match drivers, so a polished CV outranks a proven hand with a one-page résumé and a stack of cert cards.
  evidence: ['data/taxonomy.json:4-145', 'pipeline/jobfit/gemini.py:432-435', 'app/_lib/screen-wave.ts:129-174']
  code_check: by-design
  l2_priority: med   # L2 confirms how the prose actually reads for a thin-CV trades applicant
  verdict: Good machinery fed wrong-domain context plus the exact résumé-centric ranking I built this whole lens to catch.

- id: HRCON-OB-07
  journey: full-onboarding-lifecycle
  character: hr-construction-director
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: senior-quality
  title: Interview rubric axes are generic knowledge-work — nothing for a trade (safety, plan/work-order reading, hands-on aptitude, reliability)
  expected: Rubric competencies for a trade — safety mindset, reads plans/work orders, hands-on aptitude, attendance/reliability, crew fit.
  got: Rubric = Technical depth / Problem-solving / Communication / Experience & fit / Motivation, plus an early-career BARS model; no trade-specific axis.
  evidence: ['app/_lib/interview-rubric.ts:26-43']
  code_check: confirmed-absent
  l2_priority: low
  verdict: Usable as generic axes, but a senior construction HR pro would rebuild it; not job-blocking.
```

## Strengths (what NOT to touch)

- **Accept → onboarding chain is genuinely solid.** The accepted offer's token
  doubles as the onboarding link, surfaced inline as a concrete next step with
  declined/expired terminal states and a 48h deadline countdown
  (`app/offer/[token]/page.tsx:194-238`). No dead-end at the hand-off.
- **Screening decision machinery is senior-grade** — preview/commit dry-run, a
  fail-closed fairness gate, optimistic CAS so a stale reject is a no-op, a sealed
  tamper-evident decision record, and queued rejection comms that never silently
  ghost (`app/_lib/screen-wave.ts:98-251`). The *regime* is wrong for me, but the
  engineering is exactly what I'd want — IF it ran on a cert knockout.
- **Auto/human attribution is honest by construction** — unknown decision kinds
  stay `unknown`, never default to AUTO, so accountability is never misattributed
  to the machine (`app/_lib/decision-attribution.ts:84-87`). That's the kind of
  honesty an auditor respects.
- **Onboarding tasks are editable + bounded** (`coerceTasks`, onboarding.ts:41-56)
  — I can build my own jobsite checklist; it's a blank slate, not a locked office
  one.
- **Single-source taxonomies** mean extending to a trades family is a data change,
  not a code rewrite — `ROLE_FAMILIES` is generated from the benchmarks file
  (`pipeline/jobfit/taxonomy.py:78-82`), so the build is *structurally* extensible
  to construction even though it ships none of it.
- **Honest seams.** The e-sign ceiling (audit-stamped, not eIDAS/ESIGN) is named
  in the code itself (onboarding.ts:1-6) — a strength to keep, not a defect.

## Grounding score per AI surface

Inputs scored: {real CV, real JD, role/industry taxonomy, market/industry comp,
company size, jurisdiction, prior pipeline history, this Character's own data}.

| AI surface | grounding | note |
|---|---|---|
| Match / shortlist reasoning | **2 / 8** | gets CV-derived skills + JD requirements; taxonomy wrong-industry (no trades), comp absent, jurisdiction Czech, no cert/license/hours/references inputs (taxonomy.json:4-145, gemini.py:432-435) |
| CV analysis / salary read | **1 / 8** | extraction works; comp is CZK-monthly-tech, role_band None for trades, no hourly/per-diem/prevailing/USD (salary_benchmarks.json:1-28, taxonomy.py:258-266) |
| Screening decision | **3 / 8** | real pipeline history + sealed record + disclosure; jurisdiction GDPR/EU-only, no cert knockout, taxonomy wrong-industry (screen-wave.ts:129-174, consent.ts:1-56) |
| Interview prep / rubric | **2 / 8** | archetype-aware; axes generic knowledge-work, no trade relevance (interview-rubric.ts:26-43) |
| Onboarding (deterministic) | **1 / 8** | not LLM; defaults office-only, editable but industry-blind, questionnaire fixed (onboarding.ts:13-32) |

**Overall grounding for Ray's world: ~2 / 8 (LOW).** The defect is uniform: strong
machinery fed bank-/Czech-/knowledge-worker context his industry can't override at
the surfaces that decide a trades hire — taxonomy, comp, the cert/license gate, and
jurisdiction.

## Per-journey verdict

**L1-conditional.** The thread *structurally* connects end to end (post → match →
analyze → pipeline → screen → schedule → offer → onboarding) with no dead-end or
re-entry loop, and the accept→onboarding hand-off is sound — so it's not L1-fail.
But it carries **three blockers** (no trades taxonomy; CZK-salary-not-hourly comp
with no band for trades; no cert-license knockout / no W-2-vs-1099 classification)
and **three majors** (office-only onboarding, GDPR-not-EEOC compliance, résumé-
centric match reasoning) that put the *output* far below Ray's senior bar at every
AI surface. These are conclusive at L1 — you can't conjure a family, a wage grid,
or a license-gate the code doesn't have — so they carry forward; L2 is worth
running only to confirm how the prose *reads* for a thin-CV trades applicant and
whether the questionnaire const is truly non-extensible.

## Estimated time saved (with confidence)

**For Ray's actual project-burst trades use case: roughly zero, likely negative.**
The app can't knock out on a required license, can't quote an hourly/per-diem
number, ships no jobsite onboarding, and never asks the W-2-vs-1099 question — so
he re-screens by hand, builds onboarding from scratch, and still carries the
classification/cert risk himself, on top of a match that ranks his floor backwards
by favoring résumé polish. **Confidence: high** — the gaps are structural and
code-confirmed, not latency/quality nuances only L2 would reveal. The screening
*automation* would save real burst time IF it ran on his cert knockouts; the
engine is there, the inputs aren't. **Adopt? No** — not for a commercial GC as
shipped. *(My ~20-25 hr/burst manual baseline is an offline estimate from how my
own shop runs, not a cited benchmark.)*

## First-person Character review

> Somebody built a *serious* recruiting engine here — I'll give them that. The
> screening flow is better than what we run: it shows me the cut before it pulls
> the trigger, it won't reject the same guy twice, it seals a record, it doesn't
> leave a candidate hanging. On a corporate IT desk that's a real tool.
>
> But this thing has never been on a jobsite. It wants a LinkedIn and a skills
> graph; my best electrician's whole résumé is one page and his real credential is
> a journeyman card, an OSHA 30, a hot card, and three foremen who'll vouch for
> him — and the tool ranks the pretty CV over him. It never once asks the question
> that legally gates the hire: *does he hold the ticket?* You can't put an
> unlicensed electrician or an uncertified operator on my job — that's not a
> preference, that's the law — and the app would advance him without blinking. It
> never asks whether the guy's a W-2 employee or a 1099 sub, which is the one call
> that can get me and the company sued. It quotes me a *monthly salary in Czech
> crowns* when I run dollars-an-hour plus per-diem plus prevailing wage on the
> public work — and for my trades it can't even produce a band. Onboarding thinks
> day one is ordering a laptop and asking your t-shirt size; mine is I-9, a drug
> screen, an OSHA orientation, PPE issued, and a badge before anyone steps on the
> deck. And the compliance is all GDPR and EU AI Act — my auditor is OFCCP and the
> feds at I-9; "we sealed a rationale" is not an adverse-action notice.
>
> The bones are extensible — the role list is one generated file, the onboarding
> checklist is editable — so this *could* be made to fit my world. But as-shipped
> it's a salaried, European, desk-job tool, and I'd be rebuilding every part that
> matters: the trades, the wage structure, the cert gate, the compliance, the
> onboarding. I wouldn't adopt it for the field, and I wouldn't send a peer at
> another GC to it. I'd tell my buddy in corporate IT recruiting to take a look —
> that's who built it, and that's who it's for. Not me.
