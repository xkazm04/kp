---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-restaurant-generalist
character_name: Sofia Marchetti
cert_level: L1
language: en
verdict: L1-fail
---

# L1 — Sofia Marchetti (one-person HR, US casual-dining group, ~120 hourly/tipped) · full-onboarding-lifecycle

> Method: theoretical walk over the code-derived surface model (no browser). Fit
> lens = **US, hourly/tipped, very-high-churn, near-zero budget, no recruiter**.
> Central question at every AI/automation step: does this fit *my* restaurant, or
> is it bank-shaped and Czech-shaped? Spot-verified the 4 anchors most load-bearing
> for my lens before judging: `data/taxonomy.json`, `data/salary_benchmarks.json` +
> `pipeline/jobfit/salary_band.py`, `app/_lib/onboarding.ts`, `app/_lib/screen-wave.ts`.

## Per-stage walkthrough (in voice)

**1. Post / ingest the role.** I'd open Jobs and try to post "Server – nights &
weekends." First problem before I type anything: the role taxonomy
(`data/taxonomy.json`) is *entirely* software/IT/data/product — python, react,
kubernetes, scrum, "software_engineering / data_ai / product_project" families.
There is no "server," "line cook," "dishwasher," "bartender," "host." My whole
workforce doesn't exist in this tool's vocabulary. Who is this for? Not me.

**2. AI match / shortlist.** The reasoning engine's system prompt literally says
*"You are a precise technical recruiter for the Czech tech market"*
(`pipeline/jobfit/match_reasoning.py:23`), and the context it builds is
archetype/seniority/roleFamily/skills (`:34-56`) — tech fields. For a $14/hr
server there are no skills to tally and no archetype. Even if it returned prose,
I don't want an essay about a dishwasher. Wrong job, wrong shape.

**3. CV analysis + salary read.** The comp anchors are CZK monthly gross, Czech
tech roles only (`data/salary_benchmarks.json:2-28`), and the money invariant is
hardcoded `SALARY_STEP = 5000` CZK/month with a CZK plausibility ceiling
(`pipeline/jobfit/salary_band.py:20-33`). My world is **$/hr + tip credit**.
There is no hourly, no tipped-minimum, no dollars. A salary read here is not
"slightly off" — it's a different planet.

**4–5. Pipeline + screening decisions.** Credit where due: the screen-wave has a
human-in-the-loop preview (`dryRun`), an audit trail, and a fairness gate that
fails closed (`app/_lib/screen-wave.ts:98-169`). But the fairness protection is
keyed to tech *archetypes* (`isFairnessProtected`/`isKnownArchetype`, `:156-157`)
and the compliance scaffolding around it is GDPR/EU-shaped (consent retention,
anonymization — `app/_lib/consent.ts:8-58`). My liability is **US: I-9 work
authorization + FLSA tip credit** — none of that exists. EU consent machinery is
overhead I can't use; the thing I'd actually be fined for is absent.

**6–8. Schedule / group-eval / offer.** For a one-person shop hiring weekly, the
offer page is reasonable in flow (accept lands on a concrete onboarding link,
`app/offer/[token]/page.tsx:203-209`) — but it shows comp as
`offer.salary … offer.currency ?? "CZK"` (`:189`), defaulting to CZK, and
finalize carries `offer.currency` through (`app/_lib/offer-finalize.ts:161`) with
no hourly/tipped notion. Fine as a link; wrong as a number.

**9. Onboarding hand-off (the stage I actually came for).** The default checklist
is pure desk-job: contract, "Order laptop and equipment," "Create email and
system accounts," "Assign an onboarding buddy," team-intro meeting
(`app/_lib/onboarding.ts:13-21`). **No W-4, no I-9 / work authorization, no
food-handler, no direct deposit, no tip acknowledgment.** Templates ARE editable
(`coerceTasks`, up to 40 tasks — `onboarding.ts:35-56`; `onboarding_templates`
table — `onboarding-store.ts:24-29`), so I *could* rebuild the right list by hand
— but that's setup work I won't do, and the default ships a legally-incomplete
list. Worse: the candidate pre-boarding questionnaire is a **hardcoded const**
(`ENTRY_QUESTIONNAIRE_FIELDS` = preferredName/tshirtSize/dietaryNeeds/equipment
Prefs/emergencyContact/startDateConfirm — `onboarding.ts:25-32`), pinned on both
the candidate read AND write paths (`onboarding-candidate.ts:40,56`) and rendered
directly by the recruiter tab (`OnboardingTab.tsx:235`). I **cannot** add "work
authorization status" or "food-handler card #" — there is no override seam. The
e-sign is an audit-stamped seam, not real eIDAS/US e-sign (`onboarding.ts:1-6`) —
fine if disclosed, which it is.

## Findings

```json
[
  {
    "id": "sofia-onboarding-no-i9-work-auth",
    "journey": "full-onboarding-lifecycle",
    "character": "hr-restaurant-generalist",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "blocker",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "Default onboarding checklist omits I-9/work-authorization, W-4, food-handler, tip-credit — and the candidate questionnaire can't capture them",
    "expected": "A US-restaurant new-hire run captures (or lets me add in one screen) work authorization (I-9), W-4, food-handler cert, direct deposit, tip-credit acknowledgment — the legally-required, fineable essentials.",
    "got": "DEFAULT_ONBOARDING_TASKS is desk-job boilerplate (contract, laptop, email accounts, buddy, team intro) with no I-9/W-4/food-handler. The pre-boarding questionnaire is a HARDCODED const (preferredName/tshirtSize/dietaryNeeds/…) with no per-template override on either the candidate read or write path, so restaurant-relevant fields cannot be added.",
    "evidence": ["app/_lib/onboarding.ts:13-21", "app/_lib/onboarding.ts:25-32", "app/_lib/onboarding-candidate.ts:40", "app/_lib/onboarding-candidate.ts:56", "app/features/sub_onboarding/OnboardingTab.tsx:235"],
    "code_check": "confirmed-absent",
    "l2_priority": "low",
    "verdict": "As the lone HR pro I would never hand out an onboarding list with no I-9 step; that's a fineable omission, not polish. Tasks are editable so it's not a hard wall — but the questionnaire is uneditable and the default ships legally incomplete. Blocker for my industry."
  },
  {
    "id": "sofia-taxonomy-no-hospitality-roles",
    "journey": "full-onboarding-lifecycle",
    "character": "hr-restaurant-generalist",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "blocker",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "Role taxonomy + match reasoning are software/IT-only — my hourly hospitality workforce doesn't exist in the model",
    "expected": "Recognize hospitality/hourly roles (server, line cook, dishwasher, bartender, host) so matching/screening output is usable for my company.",
    "got": "taxonomy.json is exclusively software/data/product terms and three tech role families; match_reasoning.py's system prompt is hardcoded to a 'Czech tech market' technical recruiter and builds context from archetype/skills/roleFamily — none of which exist for an hourly restaurant role.",
    "evidence": ["data/taxonomy.json:4-168", "pipeline/jobfit/match_reasoning.py:22-25", "pipeline/jobfit/match_reasoning.py:34-66"],
    "code_check": "confirmed-absent",
    "l2_priority": "low",
    "verdict": "Good machinery fed the wrong domain. The AI surfaces are existentially mis-aimed at my industry; I'd get tech-recruiter prose about a dishwasher, which I don't want and can't trust."
  },
  {
    "id": "sofia-comp-czk-monthly-no-hourly",
    "journey": "full-onboarding-lifecycle",
    "character": "hr-restaurant-generalist",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Compensation is CZK monthly gross end-to-end; no $/hr or tipped-wage notion",
    "expected": "Comp shown in my market's currency and period — US dollars per hour, with a tip-credit/tipped-minimum notion.",
    "got": "Salary benchmarks are CZK monthly Czech tech roles; salary_band.py hardcodes a 5000-CZK step and a CZK plausibility ceiling; the offer page defaults currency to 'CZK' (offer.currency ?? \"CZK\") and finalize carries that through. No hourly/tipped concept anywhere.",
    "evidence": ["data/salary_benchmarks.json:2-28", "pipeline/jobfit/salary_band.py:20-33", "app/offer/[token]/page.tsx:189", "app/_lib/offer-finalize.ts:161"],
    "code_check": "confirmed-absent",
    "l2_priority": "medium",
    "verdict": "A monthly CZK figure is worthless to me and looks broken to a candidate. Currency at least falls back, but the whole comp model is salaried-monthly, not hourly-tipped."
  },
  {
    "id": "sofia-compliance-eu-not-us",
    "journey": "full-onboarding-lifecycle",
    "character": "hr-restaurant-generalist",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Compliance scaffolding is GDPR/EU-shaped; US work-authorization (I-9) and FLSA tip-credit liabilities are absent",
    "expected": "Compliance that fits a US employer — I-9/work-auth tracking and tipped-wage acknowledgment — not EU-only machinery.",
    "got": "Consent module is GDPR (CONSENT_TTL_DAYS, Recruitis/Sloneek refs, anonymize-on-expiry); screen-wave fairness keys on tech archetypes. No I-9/E-Verify, no FLSA tip-credit anywhere.",
    "evidence": ["app/_lib/consent.ts:8-58", "app/_lib/screen-wave.ts:156-157"],
    "code_check": "confirmed-absent",
    "l2_priority": "low",
    "verdict": "It protects me from a regime I'm not under and ignores the two I am. EU consent retention is overhead I can't use; the I-9 miss is what actually gets the owner fined."
  },
  {
    "id": "sofia-config-burden-cannot-bring-my-data",
    "journey": "full-onboarding-lifecycle",
    "character": "hr-restaurant-generalist",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "effort",
    "title": "No zero-config path to a useful run for my industry; workspace is locked to the seeded bank dataset",
    "expected": "Open the tool, post a restaurant role, get a useful onboarding run with no taxonomy/config project and no data team.",
    "got": "The only fixture is the ČS bank corpus; multi-tenant isolation is locked to the default workspace (workspace-lock.ts, per journey/known ceilings), so I can't truly bring a 2nd-company restaurant dataset. Making the AI/onboarding fit my world requires hand-rebuilding taxonomy/templates — setup I won't do at my budget.",
    "evidence": ["app/_lib/workspace-lock.ts:1", "data/taxonomy.json:4-168", "app/_lib/onboarding.ts:13-21"],
    "code_check": "by-design",
    "l2_priority": "low",
    "verdict": "Even where things are 'editable,' the cost to make them mine exceeds the time they'd save me. A one-person shop needs zero-config; this is a configuration project."
  }
]
```

## Strengths (what NOT to touch)
- **Human-in-the-loop screening is genuinely good**: a dry-run preview commits
  nothing, the fairness gate fails *closed*, and every auto-reject is audited with
  a rationale + a queued (never-ghosting) candidate comm (`screen-wave.ts:98-169,
  189-242`). If the domain fit existed, this is the kind of defensible automation
  I'd trust.
- **Honest seams, disclosed**: the e-sign is explicitly an audit-stamped record,
  "NOT itself eIDAS-compliant" (`onboarding.ts:1-6`) — I respect a build that names
  its own limits rather than pretending.
- **Onboarding tasks are editable** (not the questionnaire): `coerceTasks` up to 40,
  a real `onboarding_templates` table (`onboarding.ts:35-56`, `onboarding-store.ts:24-29`)
  — so the desk-job default is a starting point, not a wall, for the tasks half.
- **Offer accept lands on a concrete next step** (inline onboarding link,
  `offer/[token]/page.tsx:203-209`) — no dead-end, which is more than most tools.

## Per-journey verdict: **L1-fail**
The completion thread is structurally connected (no dead-ends), but two **blockers**
sit on the stages I came for: the default onboarding run is legally incomplete for a
US restaurant *and* the candidate questionnaire is hardcoded so I can't fix it, and
the entire role/AI model is software-engineering-shaped so my hourly workforce
literally has no representation. These aren't friction — they fail my senior-quality
floor outright. Fix the domain fit (or expose a real industry/template/questionnaire
override + an hourly-comp model) before L2 is worth running for me.

## Grounding score per AI surface (for MY industry)
- **Match / shortlist reasoning** — `grounding 1/8`: gets seniority only in spirit;
  no hospitality taxonomy, no hourly comp, no US jurisdiction, no restaurant role
  context. System prompt hardcoded to Czech tech (`match_reasoning.py:23`).
- **CV analysis + salary read** — `grounding 1/8`: machinery is real, but comp is
  CZK-monthly-tech and the role family can only be one of three tech families.
- **Screening decisions** — `grounding 2/8`: good HITL/audit/fairness *mechanism*,
  but fairness keys on tech archetypes and the compliance regime is EU, not US.
- **Onboarding hand-off (deterministic, not AI)** — fit ~**2/8**: tasks editable,
  questionnaire + defaults are desk-job/EU-leaning with no US-restaurant essentials.
- **Overall grounding for MY world: ~1.5/8 (low).** This is "good machinery fed
  wrong-domain context," exactly the predicted defect — and for me it's total.

## Estimated time saved (with confidence)
**Net negative to roughly break-even — do not adopt.** (confidence: high, L1.)
My time goes into onboarding paperwork (~1–2 hrs × ~80–100 hires/yr), not the
hiring decision. This tool's onboarding defaults don't cover my legally-required
steps and its questionnaire can't be extended, so I'd still do W-4/I-9/food-handler
by hand — and I'd have spent setup time rebuilding taxonomy/templates first. The
strong screening automation saves time I don't actually spend (my GMs decide in 10
minutes). Below my adoption threshold of "zero-config to a first useful onboarding
run."

## First-person review — Sofia
"Honestly? This isn't built for me, and it doesn't take long to see it. The moment
I try to post a server role, my whole workforce — cooks, dishwashers, servers,
bartenders — isn't even in its vocabulary; it only knows software engineers. The
money's in Czech crowns per month; I pay people dollars per hour plus tips. And the
part I actually came for, onboarding, hands me a checklist about ordering a laptop
and assigning a buddy — for a line cook — with no I-9, no food-handler, no W-4. I
can edit the task list, sure, but I can't touch the new-hire questionnaire at all,
so I literally cannot ask a candidate for their work authorization. That's not a
missing feature to me, that's the thing that gets the owner fined.

What's genuinely good: the screening tool is careful — it shows me what it *would*
do before doing it, keeps a record, never silently ghosts anyone. If this were
pointed at hourly restaurant hiring in the US, that care would matter. But it's a
bank-and-tech tool wearing a hiring-platform label, and I'm a one-person HR shop
with no time and no budget to bend it into my shape.

Would I adopt it for my company? No. Would I tell another restaurant HR person
about it? Only as a 'here's what NOT to buy.' What it'd take to change my mind:
hospitality roles in the taxonomy, dollars-per-hour with tip credit, a US onboarding
template (I-9/W-4/food-handler) out of the box, and a questionnaire I can actually
edit — all with zero setup. Until then, my spreadsheet wins."
