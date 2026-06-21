---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-public-sector-recruit
character_name: Tasha Brooks
role: HR Recruitment Manager (civil service) — US city government, ~8,000 employees
cert_level: L1
method: theoretical / code-grounded (no browser)
verdict: L1-fail
---

# Tasha Brooks × full-onboarding-lifecycle — L1 (theoretical)

Civil-service fit lens: rigid merit-system rules, **scored + rank-ordered
eligibility lists**, **veterans'-preference points**, transparency / FOIA /
open-records, mandatory posting periods, **fixed published pay grades & steps**,
fairness + **auditability over speed**. The disqualifying question at every
stage: *can I read this number into a public hearing record, and does it respect
the rule-of-the-list?* I spot-verified the four anchors most load-bearing for
this lens before judging: `salary_band.py`, `data/taxonomy.json`,
`app/_lib/screen-wave.ts`, and `app/_lib/decision-record-store.ts` +
`decision-attribution.ts`.

## Per-stage walkthrough (in character)

**1. Post / ingest the role.** I can create a posting (`JobsTab.tsx`,
`app/api/jobs/route.ts`). But there's no **mandatory minimum posting period**, no
classification/grade field, and the role taxonomy (`data/taxonomy.json`) is a
wall of software/data/product IT skills. My world — sanitation supervisor, code
enforcement officer, 911 dispatcher, parks foreman — isn't in the graph at all.
"Public sector" exists only as a **salary discount factor (0.80×)** keyed to
*Czech state pay tables* (`taxonomy.json:175`). That's not my market; it's
backwards (it shapes a *guess*, when my pay is *fixed and published*).

**2. AI match / shortlist.** Produces a sortable match score. Useful as a first
cut — but it is **not a rank-ordered eligibility list**. There is no ordinal rank
artifact, and crucially **no veterans'-preference adjustment** — the single
re-ranking step my entire process is legally built on. Sorting a fit score is not
certifying an eligibility list.

**3. CV analysis / job-fit + salary read.** The salary read is **CZK/month,
hard-anchored to the Czech market**, with a plausibility ceiling of 350,000
CZK/month (`salary_band.py:20-33`) and CZK as the offer currency default
(`offer/[token]/page.tsx:189`). For a graded civil-service role this is wrong by
construction: I may only offer the **published grade/step**, never a "market
estimate." There is no pay-grade/step concept anywhere in the codebase.

**4. Applicants in pipeline.** Consent machinery is GDPR-shaped
(`app/_lib/consent.ts`) — anonymize-on-expiry, retention TTL. Reasonable, but
silent on **FOIA / open-records retention**, which for me is the opposite
obligation (retain + disclose, not minimize + scrub).

**5. Screening decisions.** This is where the build is strongest *and* where it
fails my rule. The screen-wave **auto-rejects the bottom-% below a match
threshold** (`screen-wave.ts:169-204`), with a fairness gate. But that gate only
shields **early-career / unknown-archetype** candidates
(`screen-wave.ts:156-157`) — it has no concept of a **statutory preference
(veterans)** or a **reachable-on-the-list** protection. An automated reject that
ranks a preference-eligible veteran out, with the machine as actor (`actor:
"system"`, `:204`), is a merit-system / rule-of-the-list violation in my
jurisdiction even though the code is careful. The good news: it is **previewable
(dryRun)** and **sealed into a tamper-evident hash chain** with
`policyVersion` + itemized inputs (`decision-record-store.ts`,
`screen-wave.ts:215-223`).

**6. Interview schedule / prep / rubric.** Generic; usable. Timezone handling
fine for US. Rubric isn't tied to a civil-service rating plan, but it's editable
territory — minor for me.

**7. Group-eval / fair pick.** Fairness + sanity checks exist. But "fair" here is
archetype-balance, not **rank-of-the-list compliance** — the legal definition of
fair in my world.

**8. Offer.** Renders a single salary number + currency (default CZK),
`offer/[token]/page.tsx:185-192`. No grade/step. Accept lands on a concrete
onboarding CTA (`:203-209`) — that bridge is solid.

**9. Onboarding hand-off.** Default tasks are generic office (contract, ID,
laptop, accounts, buddy, first-day, intro — `onboarding.ts:13-21`) and the entry
questionnaire is t-shirt size / dietary / equipment (`:25-32`). None of my
public-sector pre-boarding (fingerprinting/background, **oath of office**, ethics
/ conflict-of-interest disclosure, residency verification). It **is** editable
per template via `coerceTasks` (`onboarding.ts:41-56`) — so I can add them, which
saves this stage from a blocker.

## L1 findings

```yaml
- id: PSR-L1-01
  journey: full-onboarding-lifecycle
  character: hr-public-sector-recruit
  cert_level: L1
  type: missing-feature
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: missing
  title: No rank-ordered eligibility list or veterans'-preference adjustment
  expected: An ordinal, rank-ordered eligibility list with statutory-preference
    (veterans') points applied as a separate, itemized re-ranking step — the two
    artifacts a merit-system hire is legally built on.
  got: A sortable match/fit SCORE only. No ordinal-rank artifact; no concept of a
    preference adjustment anywhere in match, screen, or group-eval.
  evidence: ['app/_lib/screen-wave.ts:129-144', 'data/taxonomy.json:154', 'app/_lib/automation-fairness.ts']
  code_check: confirmed-absent
  l2_priority: high
  verdict: My core legal artifact does not exist; the job cannot be done defensibly.

- id: PSR-L1-02
  journey: full-onboarding-lifecycle
  character: hr-public-sector-recruit
  cert_level: L1
  type: trust
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Automated screen-wave reject can rank out a preference-eligible candidate (rule-of-the-list)
  expected: No candidate is removed from contention by the machine; statutory
    preference is honored; the fairness gate understands veterans / reachable-on-list,
    and certification is a human-of-record act.
  got: screen-wave auto-rejects the bottom-% (actor "system") with a fairness gate
    that only shields early-career / unknown-archetype — no statutory-preference
    or rule-of-the-list protection.
  evidence: ['app/_lib/screen-wave.ts:156-157', 'app/_lib/screen-wave.ts:169-204', 'app/_lib/archetypes.ts']
  code_check: present-broken   # gate present, but scoped to the wrong protected class for my jurisdiction
  l2_priority: high
  verdict: A correct-looking auto-reject that's a merit-system violation in my regime is worse than none.

- id: PSR-L1-03
  journey: full-onboarding-lifecycle
  character: hr-public-sector-recruit
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Salary is a Czech-market estimate (CZK/month); no published pay grade/step
  expected: Comp surfaces as a fixed published pay GRADE + STEP (the only number a
    civil-service recruiter may offer), or is overridable to one.
  got: Salary is hard-anchored to CZK/month with a Czech-market plausibility
    ceiling; offer currency defaults to CZK; no grade/step concept exists.
  evidence: ['pipeline/jobfit/salary_band.py:20-33', 'app/offer/[token]/page.tsx:185-192', 'data/taxonomy.json:175']
  code_check: confirmed-absent
  l2_priority: med
  verdict: A "market estimate" on a graded role is wrong by construction and one I'm legally barred from honoring.

- id: PSR-L1-04
  journey: full-onboarding-lifecycle
  character: hr-public-sector-recruit
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: senior-quality
  title: Role taxonomy carries no civil-service classifications
  expected: Municipal job families (public safety, sanitation, code enforcement,
    dispatch, parks, clerical-classified) so match/fit reasoning fits my roles.
  got: taxonomy.json is software/data/product IT skills; "public sector" appears
    only as a Czech state-pay-table salary discount, not as a role family.
  evidence: ['data/taxonomy.json:4-168', 'data/taxonomy.json:154', 'data/taxonomy.json:175']
  code_check: confirmed-absent
  l2_priority: med
  verdict: The match engine has nothing to ground my roles in; reasoning will be off-domain.

- id: PSR-L1-05
  journey: full-onboarding-lifecycle
  character: hr-public-sector-recruit
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: med, reachability: high, trust_erosion: high }
  dimension: trust
  title: No FOIA / open-records export of the disposition record
  expected: A one-action export of the full per-applicant decision chain (inputs,
    score, rank, actor, rationale) to satisfy an open-records request or a
    commission hearing.
  got: A tamper-evident hash chain exists internally (strong), but no surfaced
    FOIA-grade export; consent layer is GDPR minimize/scrub-on-expiry — the
    OPPOSITE of my retain-and-disclose obligation.
  evidence: ['app/_lib/decision-record-store.ts:159-191', 'app/_lib/consent.ts:8-58']
  code_check: confirmed-absent   # the chain exists; a public-records export surface does not
  l2_priority: med
  verdict: I can't hand a commissioner what I can't export; GDPR-scrub may even delete what I'm required to keep.

- id: PSR-L1-06
  journey: full-onboarding-lifecycle
  character: hr-public-sector-recruit
  cert_level: L1
  type: missing-feature
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: low }
  dimension: missing
  title: Onboarding lacks public-sector pre-boarding defaults (oath, ethics, background)
  expected: Default or addable tasks for oath of office, ethics/conflict disclosure,
    fingerprinting/background, residency verification.
  got: Defaults are generic office (contract/ID/laptop/accounts/buddy); questionnaire
    is t-shirt/dietary/equipment. BUT tasks are editable per template.
  evidence: ['app/_lib/onboarding.ts:13-21', 'app/_lib/onboarding.ts:25-32', 'app/_lib/onboarding.ts:41-56']
  code_check: by-design   # editable via coerceTasks — I can add them
  l2_priority: low
  verdict: Editable, so not a blocker — but nothing here knows my world out of the box.
```

## Strengths (what NOT to touch)

- **Tamper-evident decision hash chain** (`decision-record-store.ts:111-191`):
  atomic seal, `prevHash` linking, `verifyDecisionChain()` recompute. This is
  *exactly* the immutability backbone a hearing-grade record needs — the rarest
  thing to find in an AI hiring tool, and they built it. Strength.
- **Three-state, fail-safe auto/human attribution** (`decision-attribution.ts:81-87`):
  an unmapped kind defaults to **unknown**, never AUTO — refusing to misattribute
  accountability to the machine is precisely my instinct. Strength.
- **Screen-wave preview (dryRun) before commit** (`screen-wave.ts:114-117,189-191`):
  nothing is flipped, queued, or audited on preview. A human reviews, then
  commits — the closest thing here to "AI recommends, human certifies."
- **Fairness gate fails CLOSED** (`screen-wave.ts:152-162`): an unknown archetype
  is shielded, not silently rejected, and the desync is recorded. Right reflex —
  just scoped to the wrong protected class for me.

## Per-journey verdict: **L1-fail**

Two blockers (no eligibility-list/veterans'-preference artifact; an auto-reject
that violates rule-of-the-list for a preference-eligible candidate) sit on the
load-bearing path of a merit-system hire. The machinery is unusually
trustworthy, but it is built for *discretionary at-will* hiring, not *rule-bound
competitive* hiring. Fix the structural gaps before any L2 in my voice.

## Grounding score per AI surface (of {real CV, real JD, role/industry taxonomy,
market/industry comp, company size, jurisdiction, prior pipeline history, this
Character's own data})

- **Match / shortlist** — 3/8 (real CV, real JD, prior history reach the prompt;
  taxonomy is wrong-domain, comp/jurisdiction/size/my-data absent). `evidence:
  data/taxonomy.json:4-168`
- **CV analysis / salary read** — 2/8 (CV + JD; comp is CZK-locked, no
  jurisdiction/grade). `evidence: pipeline/jobfit/salary_band.py:20-33`
- **Screen-wave** — 3/8 (cohort scores, policy version, archetype; no
  jurisdiction/preference/list-context). `evidence: app/_lib/screen-wave.ts:127-144`
- **Group-eval** — 3/8 (archetype-balanced, not rule-of-the-list aware).
- **Onboarding (deterministic)** — 1/8 (editable but knows nothing of my world).
- **Overall grounding: ~2.4/8 (LOW for this Character)** — good machinery fed
  bank/Czech context; for US municipal civil service the domain inputs are mostly
  absent.

## Estimated time-saved + adopt?

If the score were decomposable, the ranking + veterans' points explicit, and the
record FOIA-exportable, the app could save my **12–20 scoring/rationale/record
hours per posting** (confidence: **low** — that "if" is exactly what's missing
today; estimate is offline US-local-gov norms). As built, the rework to
re-justify an un-defendable score by hand exceeds the saving, and a single
auto-reject of a preference-eligible veteran is a lawsuit. **Adopt: NO** (would
revisit only if eligibility-list + veterans'-preference + human-certification +
FOIA-export land).

## First-person review (Tasha's voice)

I'll give them credit I rarely give a vendor: the audit *plumbing* is the real
thing. The hash chain, the human-vs-machine attribution that refuses to guess,
the preview-before-you-commit — somebody on this team has sat in a room where a
decision got challenged. That instinct is correct, and it's why I read all the
way to the end instead of closing the tab at the CZK salary.

But it's built for a world where a manager picks who they like. Mine isn't that
world. I don't have a shortlist; I have an **eligibility list** — ranked,
ordinal, with **veterans' points added on a separate line** — and I may only
reach into the top of it. This tool has a *score*, and a score is not a list, and
nowhere does it know a veteran gets points. Worse, it will quietly *auto-reject*
the bottom of the pool — and the day that bottom contains a preference-eligible
applicant who outranks someone it kept, I'm in front of the civil-service
commission explaining why a machine broke the rule of the list. "The fairness
gate protected early-career candidates" is not an answer that survives that room.

And the money is simply wrong: it estimates a *market* salary in Czech crowns for
a job whose pay is a **published grade and step** I'm legally bound to. I don't
*want* an estimate. I have a number. The tool has no place to put it.

What's missing for my world: a real ranked eligibility list, statutory-preference
points, "AI recommends / human of record certifies" stamped on every
disposition, comp as grade+step, and a one-click open-records export that hands a
commissioner the same story every time. Would I tell a peer? Only a private-
sector one. To my civil-service network I'd say: *good bones, wrong building —
don't put it near a competitive posting until it learns the rule of the list.*
