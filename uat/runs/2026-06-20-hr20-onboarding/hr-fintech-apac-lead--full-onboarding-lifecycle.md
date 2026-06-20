---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-fintech-apac-lead
character_name: Wei Lin Tan
role: People & Talent Lead — MAS-regulated payments fintech, ~500p, SG/HK/IN
cert_level: L1
method: theoretical / code-grounded (no browser)
language: en
---

# L1 — Wei Lin Tan walks the full candidate lifecycle → onboarding

> Lens: APAC hypergrowth payments fintech, three markets / three currencies
> (S$/HK$/₹), MAS fit-and-proper for a slice of roles, Singapore fair-employment.
> Central question at every AI surface: does the output fit MY market/industry/
> jurisdiction, or is it bank-shaped and Czech-shaped?

## Per-stage in-character walkthrough

**1. Post / ingest the req.** I open Jobs and author or ingest a Senior Backend
Engineer req for the Singapore hub. Structurally the JD path is real
(`app/features/sub_jobs/JobsTab.tsx`, ingest `app/_lib/job-ingest.ts`, builder
`app/features/sub_library/JdBuilder.tsx`). The **role taxonomy** is genuinely
strong on engineering — Python, Go, Kubernetes, Kafka, security, even DORA/
NIS2/ISO-27001 tags (`data/taxonomy.json:4-71`). So my *role families* are
covered. But the seniority surface forms and `company_adjustments` are CZ-shaped
(Prague R&D-centre rationale, `data/taxonomy.json:170-176`), and there's no MAS /
fit-and-proper / regulated-role concept anywhere in the graph. Workable for role
matching; not for my regulatory slice.

**2. AI match / shortlist.** I run match reasoning. The grounding machinery is
decent — it passes real candidate facts, matched/missing skills, and the job's
must-haves into the prompt (`pipeline/jobfit/match_reasoning.py:34-75`). But the
**system prompt hard-codes my market away**: *"You are a precise technical
recruiter for the Czech tech market"* (`match_reasoning.py:23-24`). My Singapore
shortlist is being reasoned by a Czech recruiter persona. The prose may still
name real CV facts (good), but the framing is wrong-country by construction.

**3. CV analysis / job-fit + the comp read.** This is where it breaks for me. The
salary read is **CZK-monthly, Czech-market, by architecture**: the Gemini prompt
states *"Salary numbers are monthly gross CZK based on the current Prague/Czech
tech market"* (`pipeline/jobfit/gemini.py:433`); the estimate defaults
`currency=CZK, period=month` (`pipeline/jobfit/pipeline.py:626-627`); the anchor
bands are CZK-monthly only (`data/salary_benchmarks.json:2-28`); and the whole
app is pinned to one currency — `APP_CURRENCY = "CZK"`, locale `cs-CZ`, *"The app
does not do FX"* (`app/_lib/format.ts:6-18`). A Senior Backend Engineer in
Singapore is ~S$130–180k **annual**; this hands me ~110–165k **CZK/month**. Wrong
currency, wrong cadence, wrong market — and no bonus/equity dimension. For me this
output is not "modest," it's actively misleading.

**4. Applicants in the pipeline.** Pipeline + drawer are real
(`app/features/sub_pipeline/PipelineTab.tsx`), and there's a genuine consent /
anonymization layer (`app/_lib/consent.ts`) with a 12-month GDPR retention
default. Good hygiene — but it's **GDPR-shaped** (the doc literally cites
Recruitis/Sloneek, `consent.ts:1-10`). Nothing maps to MAS data norms or
Singapore PDPA; it's borrowed compliance.

**5. Screening decisions.** Strong here. The screen wave is human-in-the-loop by
design — dry-run preview, then commit (`app/_lib/screen-wave.ts:98-117,189-193`);
a fail-closed fairness gate shields early-career / unknown archetypes
(`screen-wave.ts:152-162`); every auto-reject is sealed to a tamper-evident
record with policy version + rationale (`screen-wave.ts:215-223`); attribution is
honestly three-state auto/human/unknown (`app/_lib/decision-attribution.ts:84-87`).
This is real audit machinery. My problem: the *fairness lens is archetype/early-
career* (EU-AI-Act-flavoured), with **no fit-and-proper hook** — I can't record
"this role required honesty/competence/financial-soundness vetting" anywhere.

**6. Interview schedule + prep + rubric.** Out of my deep-verify budget; noted as
present (`app/features/sub_schedule/ScheduleTab.tsx`, `app/_lib/timezone.ts`).
Timezone support exists, which matters for SG/HK/IN — defer quality to L2.

**7. Group-eval / fair pick.** Notably honest on my exact pain: it refuses to
compare a candidate's salary expectation against the role band across currencies —
*"the app does no FX … handing the LLM a cross-currency number … "* and gates on
`isSameCurrency(..., APP_CURRENCY)` (`app/_lib/group-eval-run.ts:209-214`). The
build *knows* it's single-currency and fails safe. That's a strength — but it
also confirms my whole world is the unsupported path.

**8. Offer.** Offer page renders comp with `offer.currency ?? "CZK"`
(`app/offer/[token]/page.tsx:189`) — currency is at least a field, but defaults
CZK and there's no bonus/equity/annual structure. Accept lands on a concrete
onboarding CTA inline (`offer/[token]/page.tsx:194-209`) — completion thread is
intact, good.

**9. Onboarding hand-off.** Deterministic and clean. Default tasks are generic-
office (contract, ID/tax/bank, laptop, accounts, buddy, first-day, team intro —
`app/_lib/onboarding.ts:13-21`) and the entry questionnaire is small/non-sensitive
(`onboarding.ts:25-32`). Crucially the tasks are **editable per template**
(`coerceTasks`, `onboarding.ts:41-56`) — so I *can* add fit-and-proper / work-pass
steps. But nothing is *there* for a regulated APAC employer; it's a blank generic
default, and e-sign is an honestly-named provider seam, not eIDAS (`onboarding.ts:1-6`).

## L1 findings

```yaml
- id: HRAPAC-OBL-01
  journey: full-onboarding-lifecycle
  character: hr-fintech-apac-lead
  cert_level: L1
  type: quality-gap
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Comp read is CZK-monthly Czech-market by architecture — wrong currency, cadence, and market for all three of her markets
  expected: An annual comp range in the role's market currency (S$/HK$/₹) with a basis.
  got: The pipeline emits CZK/month, Prague/Czech-anchored, with no FX and a single APP_CURRENCY; her Singapore/HK/India numbers are unrepresentable.
  evidence:
    - 'pipeline/jobfit/gemini.py:433'
    - 'pipeline/jobfit/pipeline.py:626'
    - 'data/salary_benchmarks.json:2'
    - 'app/_lib/format.ts:6'
    - 'app/_lib/format.ts:18'
  code_check: confirmed-absent
  l2_priority: low   # the gap is structural; L2 would only re-confirm CZK output
  verdict: This is the #1 fit-gap. A wrong-market comp number is worse than none — she must catch and redo it, so time-saved goes negative.

- id: HRAPAC-OBL-02
  journey: full-onboarding-lifecycle
  character: hr-fintech-apac-lead
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Match-reasoning system prompt hard-codes the Czech tech market — her APAC shortlist is reasoned by a Czech-recruiter persona
  expected: Reasoning framed for the role's market/industry (Singapore/HK/India fintech eng).
  got: '"You are a precise technical recruiter for the Czech tech market" is the fixed system role.'
  evidence:
    - 'pipeline/jobfit/match_reasoning.py:23'
    - 'pipeline/jobfit/match_reasoning.py:24'
  code_check: confirmed-absent
  l2_priority: high   # confirm whether real prose leaks Czech-market framing / mislabels seniority
  verdict: Machinery is well-grounded on CV facts, but the lens is wrong-country and unconfigurable.

- id: HRAPAC-OBL-03
  journey: full-onboarding-lifecycle
  character: hr-fintech-apac-lead
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: med, reachability: high, trust_erosion: high }
  dimension: trust
  title: Compliance + screening is GDPR/EU-AI-Act-shaped with no MAS fit-and-proper or Singapore fair-employment hook
  expected: A screening/decision record and a role flag she can defend under MAS fit-and-proper and Singapore workplace-fairness rules.
  got: Consent is GDPR/Recruitis-modelled; the fairness gate is archetype/early-career; no fit-and-proper, right-to-work, or regulated-role concept exists.
  evidence:
    - 'app/_lib/consent.ts:1'
    - 'app/_lib/screen-wave.ts:152'
    - 'app/_lib/decision-attribution.ts:84'
  code_check: confirmed-absent
  l2_priority: med
  verdict: The audit machinery is genuinely strong (human-in-loop, sealed records) — but borrowed-jurisdiction. Usable, not defensible in her regime as-is.

- id: HRAPAC-OBL-04
  journey: full-onboarding-lifecycle
  character: hr-fintech-apac-lead
  cert_level: L1
  type: missing-feature
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: missing
  title: Onboarding defaults are generic-office; no fit-and-proper / work-pass / regulated-role steps (though editable)
  expected: Pre-boarding that carries fit-and-proper declaration, work-pass/right-to-work, and regulated-role checks for her markets.
  got: DEFAULT_ONBOARDING_TASKS is generic office; questionnaire is 6 non-sensitive fields. Editable via coerceTasks, so she CAN add them — nothing is there.
  evidence:
    - 'app/_lib/onboarding.ts:13'
    - 'app/_lib/onboarding.ts:25'
    - 'app/_lib/onboarding.ts:41'
  code_check: by-design   # editability exists; the gap is the absent default, not a lock
  l2_priority: low
  verdict: Downgraded to minor BECAUSE tasks are editable — the seam is open, just unfurnished for her industry.

- id: HRAPAC-OBL-05
  journey: full-onboarding-lifecycle
  character: hr-fintech-apac-lead
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: senior-quality
  title: Comp has no bonus/equity dimension — base/band only, which is most of the package in a scale-up
  expected: A package read that names bonus + equity alongside base.
  got: Salary model is a single (min,max) band; offer stores one salary + currency; no variable/equity field.
  evidence:
    - 'data/salary_benchmarks.json:8'
    - 'app/_lib/offers-store.ts:82'
    - 'app/offer/[token]/page.tsx:185'
  code_check: confirmed-absent
  l2_priority: low
  verdict: Compounds OBL-01; even in the right currency it would understate her real offer.
```

## Strengths (what NOT to touch)
- **Screening is genuinely audit-grade**: dry-run preview → commit, fail-closed
  fairness gate, tamper-evident sealed records, honest three-state attribution
  (`screen-wave.ts:98-223`, `decision-attribution.ts:84-87`). Best-in-class HITL.
- **Cross-currency honesty**: group-eval refuses to compare across currencies and
  says so (`group-eval-run.ts:209-214`) — the build names its own seam rather than
  faking FX. A trust *win*, even though it confirms her path is unsupported.
- **Role taxonomy is strong on eng/fintech skills** incl. regulated-industry tags
  (`taxonomy.json:4-71`) — her *roles* match, only her *market/comp/jurisdiction* don't.
- **Completion thread is intact** end-to-end: accept lands on a concrete inline
  onboarding CTA (`offer/[token]/page.tsx:194-209`); onboarding tasks are editable
  (`onboarding.ts:41-56`); no dead-ends found in the surface model.

## Per-journey verdict: **L1-conditional**
The thread completes with no dead-ends and the screening/audit machinery clears a
high bar — but two findings sit at blocker/major on the *headline AI output* she'd
stake her name on (comp market+currency; Czech-market reasoning persona). These
carry forward to L2. Not an L1-fail (nothing structurally blocks finishing the
job); decidedly not an L1-pass (the output is wrong-market by architecture).

## Grounding score per AI surface
Scale = {real CV, real JD, role/industry taxonomy, market/industry comp, company
size, jurisdiction, prior pipeline history, her own 3-market data} = 8 inputs.
- **Match reasoning** — real CV ✓, real JD ✓, taxonomy ✓(eng), comp ✗, size ✗,
  jurisdiction ✗(Czech-locked), history partial, her data ✗ → **grounding 3.5/8**.
- **CV analysis + comp** — CV ✓, JD ✓, taxonomy ✓, comp ✗(CZK/month), size ✗,
  jurisdiction ✗, history ✗, her data ✗ → **grounding 3/8**.
- **Screening / decisions** — strong on HITL+audit, but jurisdiction ✗(EU/GDPR),
  her comp/market context n/a → **grounding 4/8** (best of the set).
- **Group-eval** — honest single-currency gate; her cross-currency case is the
  unsupported branch → **grounding 3/8**.
- **Overall grounding: ~3.4 / 8 (≈ 0.42)** — good machinery, fed Czech/bank-shaped,
  single-currency context that her three-market world cannot enter.

## Estimated time-saved + adopt?
- **Confidence: medium** (L1 / code-grounded; live prose quality deferred to L2).
- On the **screening + shortlist machinery alone**, plausibly a real cut toward
  ~10 hrs/hire IF the output were market-correct. But for HER the comp read is
  **wrong-market by architecture**, so she must catch and redo every comp number —
  **net time-saved is negative on the comp axis**, and comp is the gate.
- **Adopt? NO, not today** — not until comp is multi-currency/annual and the
  reasoning lens is configurable off "Czech tech market." She'd pilot the
  screening audit trail in isolation, nothing more.

## First-person review — Wei Lin Tan
"The bones are good — better than most 'AI recruiter' demos I've sat through. The
screening trail is the real thing: it previews before it acts, it shields people
it shouldn't auto-cut, and it seals a record I could actually hand an auditor. I
respect that the group-eval *refuses* to compare a Hong Kong dollar against
whatever band and tells me so — that's a tool being honest about its limits, and
I trust honesty more than confidence.

But it's built for one country and one currency, and that country isn't mine.
Every salary it hands me is CZK per month for the Prague market — I hire in
Singapore dollars, Hong Kong dollars, and Indian lakhs, all annual, all with
bonus and equity that matter more than base. A wrong-currency number isn't a
rough draft I can polish; it's a number I have to *catch* before it embarrasses
me in front of a Bangalore manager. The match reasoning literally introduces
itself as a Czech recruiter. And my regulated slice — the MAS fit-and-proper
roles — has nowhere to live: the compliance story is all GDPR and EU AI Act,
which is someone else's law.

What's missing for my world: multi-currency, annual, package-aware comp; a
reasoning lens I can point at Singapore fintech; a fit-and-proper / work-pass hook
in screening and onboarding. Until then I'd run *one* thing — the screening audit
trail — and keep my comp spreadsheet. Would I tell a peer? I'd tell my Czech-bank
counterpart to look hard. For an APAC fintech friend I'd say: brilliant engine,
wrong continent — wait for the multi-market version."
