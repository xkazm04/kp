# L1 — Oliver Hartley (hr-consulting-ta-lead) × full-onboarding-lifecycle

- **Character:** Oliver Hartley — Talent Acquisition Lead, mid management-consulting firm (~900), UK / London, en.
- **Cert level:** L1 (theoretical, code-grounded — no browser).
- **Journey:** `full-onboarding-lifecycle`.
- **Fit lens:** up-or-out; campus cohort + lateral hiring; **case-study + competency** interviews; **GBP base + bonus + profit share**; cohort onboarding with **staffing/utilisation from day one**; partner-presentable, defensible, premium-brand polish.
- **Reachable set:** authed workspace tabs (dev gate on, no per-role gating) — Jobs, Library, Match, Analyze, Pipeline, Decisions, Schedule, Interview, Offers, Onboarding, Analytics; peeks `/offer/[token]`, `/onboarding/[token]` for brand/comp/disclosure. Seed is a **Czech retail bank** — bank-/CZK-/tech-locked output he can't override is a finding, not just unseeded data.
- **Spot-verified anchors (Read/Grep before judging):** `data/taxonomy.json`, `data/salary_benchmarks.json`, `pipeline/jobfit/salary_band.py`, `pipeline/jobfit/match_reasoning.py`, `app/_lib/interview-rubric.ts`, `app/_lib/onboarding.ts`, `app/_lib/offer-finalize.ts` + `app/_lib/offers-store.ts`, `app/_lib/salary-band.ts` + `app/_lib/format.ts`, `app/offer/[token]/page.tsx`.

---

## Per-stage walkthrough (in character)

**1. Post / ingest the role.** "Fine, I can author a JD and set a band — but the moment I look under the bonnet at the taxonomy that scaffolds everything downstream, it's a tech catalogue." `data/taxonomy.json` is exclusively software/data/product role families (`role_family_votes` ∈ {`software_engineering`, `data_ai`, `product_project`}, taxonomy.json:5–145). "Consultant" exists only as a thin skill term (`konzultant`/`consultant`, voting 0.5 software / 0.5 product, taxonomy.json:144) and "consulting" only as a *company-type* tag with a neutral 1.00× comp multiplier (taxonomy.json:153, :174). There is **no** associate / engagement-manager / strategy / sector-specialist role family. For a consulting analyst my role collapses into `product_project` or `software_engineering`. Strike one.

**2. AI match / shortlist (real LLM).** The reasoning prompt's system message literally says **"You are a precise technical recruiter for the Czech tech market"** (`match_reasoning.py:23`). It isn't told the industry, the firm, or the brand; the context it gets is `archetype/seniority/roleFamily/skills/matchedSkills/missingMustHaves` (`reasoning_context`, match_reasoning.py:34–75) — no real CV narrative, no firm context, no campus-vs-lateral motion, no commercial-judgement axis. "It will faithfully reason about my consultant as if she were a Czech developer. That's not partner-presentable; it's wrong-domain."

**3. CV analysis / job-fit + salary read (real LLM — Gemini).** The salary engine is hard-anchored to the Czech tech market: `salary_benchmarks.json` is `"currency": "CZK"`, `"Czech Republic monthly gross … technology roles"`, only the 3 IT families (salary_benchmarks.json:2–28); `salary_band.py` rounds in CZK (`SALARY_STEP = 5000`, :20) with a CZK/month plausibility ceiling (`SALARY_PLAUSIBILITY_CEILING = 350_000`, :33) and the doc explicitly scopes itself to "CZK/month specifically" (:32–34). App currency is hardcoded `APP_CURRENCY = "CZK"` (`format.ts:18`). "A salary read for my Senior Consultant in CZK monthly gross, off a tech band, with no bonus and no profit share — I can't show that to anyone."

**4. Applicants in the pipeline.** Structurally fine — board + drawer + consent/AI-disclosure seam exist (journey anchors `PipelineTab.tsx`, `consent/route.ts`). Reachable, not my headline gap. (Consent existence not spot-read this pass; deferred to L2.)

**5. Screening decisions (real LLM).** Human-in-the-loop + decision-record + attribution machinery is present per the journey map (`screen-wave.ts`, `decision-record-store.ts`, `decision-attribution.ts`). For UK GDPR / EU AI Act high-risk hiring that's the right *shape*; adequacy of disclosure wording + audit content is an L2 quality check, not an L1 absence. Provisional strength.

**6. Interview schedule + prep + rubric (real LLM).** The fixed rubric is engineering-flavoured: `INTERVIEW_RUBRIC` = the "experienced" set whose competencies are "Technical depth / Problem-solving / Communication / Experience & fit / Motivation" (`interview-rubric.ts:35`, RUBRIC_CS:59–64), plus an early-career BARS set (decomposition / learning agility / coachability). "There is **no case-study or commercial-judgement axis**. My whole interview *is* a case. The rubric is a fixed JSON the scorer and I both read — I can't add 'structure / analytics / client presence' without editing the source file." Note: the per-archetype split (`rubricForArchetype`, :41) only switches experienced↔early-career, never role-family.

**7. Group-eval / fair pick (real LLM).** Machinery present (journey anchors); fairness + sanity checks exist. Inherits the same wrong-domain context as stage 2 — defer pick-quality to L2.

**8. Offer.** The offer is a **single `salary` INTEGER + `currency` TEXT** (`offers-store.ts:32–33, :82–83`); the candidate page renders one number and falls back to the literal `"CZK"` (`offer/[token]/page.tsx:189`). There is **no base/bonus/profit-share decomposition and no grade band** anywhere in the offer model. "Half my offer — the variable comp — has nowhere to live. To a top-tier graduate a flat number reads as either lowball or amateur."

**9. Onboarding hand-off (deterministic).** `DEFAULT_ONBOARDING_TASKS` are generic-office: contract, ID/tax/bank, laptop, accounts, buddy, first-day plan, team intro (`onboarding.ts:13–21`). `ENTRY_QUESTIONNAIRE_FIELDS` = preferredName/tshirtSize/dietary/equipment/emergencyContact/startDate (:25–32). **Good news:** tasks are **editable per template** (`coerceTasks`, :41–56, cap 40), so I *can* build a cohort joiners' list — but there's no cohort/staffing/utilisation concept, the questionnaire fields are **fixed** (a hardcoded `as const`, not editable), and e-sign is an honest provider seam, not eIDAS (`markSigned`, file header :1–6). Accept→onboarding chain is real and lands on a concrete next step (`offer-finalize.ts:97–110`; CTA at `offer/[token]/page.tsx:203–209`).

**Completion thread:** end-to-end the stages do hand off without a dead-end — accept mints the onboarding link and starts a run (offer-finalize.ts:96–122). So this is **not a broken flow**; it's a **fit/quality** journey. The job "completes" but every AI artefact is bank-/CZK-/tech-shaped below his senior bar.

---

## L1 findings

```yaml
- id: hr-consulting-L1-01
  journey: full-onboarding-lifecycle
  character: hr-consulting-ta-lead
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Role taxonomy is tech-only — consulting roles have no role family
  expected: >
    A consulting/professional-services role family (associate, consultant,
    engagement manager, strategy/M&A, sector specialist) so matching, fit, and
    shortlist reasoning are scaffolded on the right role model.
  got: >
    role_family_votes are exclusively software_engineering / data_ai /
    product_project. "consultant" is a thin 0.5/0.5 skill term; "consulting"
    is only a neutral 1.00x company-type tag. A consulting analyst silently
    collapses into a software/product family.
  evidence:
    - data/taxonomy.json:5
    - data/taxonomy.json:128
    - data/taxonomy.json:144
    - data/taxonomy.json:153
    - data/taxonomy.json:174
  code_check: confirmed-absent
  l2_priority: high   # confirm the shortlist prose actually mis-frames a consultant as a dev
  verdict: "Every downstream AI output is built on the wrong role scaffold for my world."

- id: hr-consulting-L1-02
  journey: full-onboarding-lifecycle
  character: hr-consulting-ta-lead
  cert_level: L1
  type: trust
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Comp is CZK / monthly / single-number — no GBP, no bonus, no profit share, no grade band
  expected: >
    A salary read and an offer that show base + bonus + profit share in GBP,
    banded by grade, with a basis — the standard consulting comp shape.
  got: >
    salary_benchmarks.json is currency CZK, Czech monthly gross, 3 IT families
    only; salary_band.py rounds/ceilings in CZK; APP_CURRENCY="CZK"; the offer
    model is one INTEGER salary + currency TEXT with the page defaulting to
    "CZK". No variable-comp or grade-band decomposition exists.
  evidence:
    - data/salary_benchmarks.json:2
    - data/salary_benchmarks.json:6
    - pipeline/jobfit/salary_band.py:20
    - pipeline/jobfit/salary_band.py:33
    - app/_lib/format.ts:18
    - app/_lib/offers-store.ts:32
    - app/offer/[token]/page.tsx:189
  code_check: confirmed-absent
  l2_priority: high
  verdict: "A bare CZK monthly figure with no bonus is not an offer I can put the firm's name on."

- id: hr-consulting-L1-03
  journey: full-onboarding-lifecycle
  character: hr-consulting-ta-lead
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Match-reasoning prompt is hardwired "technical recruiter, Czech tech market" with no firm/industry context
  expected: >
    Reasoning that knows it's assessing a consulting candidate for a UK
    professional-services firm, fed the real CV narrative + firm/brand + the
    campus-vs-lateral motion + a commercial-judgement lens.
  got: >
    System prompt literally pins "precise technical recruiter for the Czech tech
    market"; the context object is only archetype/seniority/roleFamily/skills +
    match scores — no real CV prose, no industry, no firm, no comp band.
  evidence:
    - pipeline/jobfit/match_reasoning.py:23
    - pipeline/jobfit/match_reasoning.py:34
    - pipeline/jobfit/match_reasoning.py:57
    - pipeline/jobfit/match_reasoning.py:102
  code_check: present-broken   # the grounding is present but wrong-domain + thin
  l2_priority: high
  verdict: "Good machinery fed thin, wrong-domain context — the predicted defect, here in the prompt."

- id: hr-consulting-L1-04
  journey: full-onboarding-lifecycle
  character: hr-consulting-ta-lead
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: senior-quality
  title: Interview rubric has no case-study / commercial-judgement axis and is a fixed source file
  expected: >
    A case-study + competency rubric (structure, analytics, communication,
    presence, commercial judgement) — the consulting interview frame — and the
    ability to add role-appropriate competencies.
  got: >
    The fixed rubric is engineering-flavoured (Technical depth, Problem-solving,
    Communication, Experience & fit, Motivation) plus an early-career BARS set;
    rubricForArchetype only switches experienced<->early-career, never role
    family. Competencies live in a shared JSON both TS and Python pin to, so a
    recruiter can't add a case axis without editing the source.
  evidence:
    - app/_lib/interview-rubric.ts:15
    - app/_lib/interview-rubric.ts:35
    - app/_lib/interview-rubric.ts:41
    - app/_lib/interview-rubric.ts:59
  code_check: confirmed-absent
  l2_priority: med
  verdict: "My interview is a case; the rubric scores a tech screen. Wrong instrument."

- id: hr-consulting-L1-05
  journey: full-onboarding-lifecycle
  character: hr-consulting-ta-lead
  cert_level: L1
  type: missing-feature
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: low }
  dimension: missing
  title: Onboarding has no cohort / staffing-utilisation concept; entry questionnaire is non-editable
  expected: >
    A cohort joiners' programme with staffing/utilisation from day one, and an
    editable pre-boarding questionnaire shapeable to a consulting joiner.
  got: >
    DEFAULT_ONBOARDING_TASKS are generic-office (contract/ID/laptop/buddy);
    tasks ARE editable per template (coerceTasks, cap 40) — a real mitigant — but
    there is no cohort/staffing/utilisation primitive, and ENTRY_QUESTIONNAIRE_FIELDS
    is a fixed `as const` (tshirt/dietary/equipment), not editable.
  evidence:
    - app/_lib/onboarding.ts:13
    - app/_lib/onboarding.ts:25
    - app/_lib/onboarding.ts:41
  code_check: by-design   # task list editable by design; cohort/utilisation + editable questionnaire genuinely absent
  l2_priority: low
  verdict: "I can rebuild the task list, but there's no notion of a cohort that has to be staffable in week two."
```

### Severity arbitration applied
- 01–04 are **senior-quality/trust failures on the headline AI outputs** (match reasoning, salary/offer, interview rubric) → **major minimum** per rubric.md:45. None rise to *blocker*: the thread still completes and the artefacts are wrong-domain, not unusable/embarrassing-to-send in the "core promise fails" sense — but 02 and 03 are at the embarrassment edge for a *premium-brand* Character.
- 05 is **minor**: a real gap (no cohort/staffing) softened by genuine task-list editability (downgraded from missing → by-design on the editable leg).

---

## Strengths (what NOT to touch)
- **Completion thread is intact + no silent success on the terminal step.** Accept mints the onboarding token, starts a run idempotently, and lands the candidate on a concrete next-step page, with operator-visible reconcile events on dispatch failure (`offer-finalize.ts:96–122`; CTA `offer/[token]/page.tsx:203–209`). "It doesn't pretend to have done something it didn't."
- **Comp comparison refuses to lie across currencies.** `isSameCurrency` gates the over/under-band verdict; no FX fabrication (`salary-band.ts:31–58`). The build *names its own seam* — a strength under rubric.md:106.
- **Salary bands degrade honestly.** `normalizeMarketSalary` zeroes an unusable band to `available:false` and defaults confidence to "low" rather than asserting a confident bogus number (`salary-band.ts:131–146`).
- **Interview rubric is single-sourced TS==JSON==Python** with CI drift guards (`interview-rubric.ts:1–13`) — so *adding* a case axis is a one-place edit, not a multi-language rewrite. The instrument is wrong, but the mechanism to fix it is clean.
- **E-sign ceiling is disclosed, not faked** (`onboarding.ts:1–6`, `markSigned` seam) — exactly the honesty Oliver wants partners to be able to rely on.

---

## Per-journey verdict: **L1-conditional**
The lifecycle completes end-to-end with no dead-end and no silent success — structurally sound. But it carries **four majors** (01–04), all on the headline AI outputs and all the *same root cause*: the engine is **bank-/CZK-/tech-shaped and Oliver can't override it from the UI**. L2-eligible; the four majors carry forward as the things to confirm live (does the prose actually mis-frame a consultant; is the offer genuinely uneditable to GBP base+bonus).

---

## Grounding score per AI surface
Grounding inputs scored: {real CV, real JD, role/industry taxonomy, market/industry comp, company size, jurisdiction, prior pipeline history, this Character's own data}.

| AI surface | grounding | note |
|---|---|---|
| Match reasoning (stage 2) | **2 / 8** | gets role/seniority/skills + match scores; **wrong-domain** taxonomy, no real CV prose, no firm/industry/comp/jurisdiction. System prompt pins "Czech tech market" (match_reasoning.py:23). |
| CV analysis + salary read (stage 3) | **2 / 8** | real CV + real JD reach Gemini (per journey anchors); but comp is CZK/monthly/tech-family-locked, no GBP/bonus/band, no industry. |
| Screening decisions (stage 5) | **3 / 8** | HITL + record + attribution present (right shape for UK GDPR/AI-Act); jurisdiction framing + industry fit unverified at L1. |
| Interview prep / rubric (stage 6) | **2 / 8** | fixed tech/early-career rubric; no case/commercial axis, no role-family selection. |
| Group-eval (stage 7) | **2 / 8** | inherits stage-2 thin/wrong-domain context. |

**Overall grounding (Oliver's lens): ~2.2 / 8 (≈ 28%).** Good machinery, thin and wrong-domain context. The dominant deficit is **industry/taxonomy + market/comp**, not real-CV plumbing.

---

## Estimated time-saved + adopt?
- **If he could override taxonomy/comp/rubric:** plausibly **lateral screening ~20–23 hrs/hire → <8 hrs**, partner-facing reasoning pre-drafted, onboarding setup **<1 hr** — a real win. **Confidence: low** at L1 (output quality unverified; AI keys/latency unconfirmed per env.md).
- **As shipped (bank/CZK/tech defaults he can't change):** the saving evaporates — he'd rewrite every reason to be partner-presentable, hand-fix every comp figure into GBP base+bonus, and reframe every rubric. Net **slower than his manual baseline on the artefact-polish leg → major** (rubric.md:44). 
- **Adopt? NOT YET** for the firm. Pilot-curious only if the four majors are addressed; today it's a tech-recruiting tool wearing a generic label.

---

## First-person Character review (Oliver's voice)
"The bones are good — it runs a req from open to onboarded without dropping it, it doesn't pretend to have sent something it didn't, and where it can't do FX or sign a contract properly it *says so* rather than bluffing. I respect that; honesty about the seams is exactly what I'd want to tell a partner.

But this is built for a Czech tech company, and I run a London consulting firm. The taxonomy thinks in developers and data scientists — my analysts and consultants have no home in it, so every shortlist reason is scaffolded on the wrong role. The salary read comes back in **CZK, monthly, off a tech band, as one number** — and in consulting the bonus and profit share *are* half the offer, so a flat figure to an LSE first reads as either a lowball or an amateur. The interview rubric scores 'technical depth'; my entire interview is a **case study**, and there's no axis for structure or commercial judgement. And under the bonnet the reasoning model is literally told it's a 'technical recruiter for the Czech tech market' — so it will faithfully, fluently, assess my consultant as if she were a developer.

Could I trust it in front of the committee? Not as it stands — I'd be redoing the reasoning, the comp, and the rubric by hand, which means the tool is costing me time, not saving it. Would I tell a peer at another firm to look? I'd say 'the engine is genuinely good and the team is clearly disciplined — but it's pointed at a bank, and until I can point it at *my* industry, my market, and my comp model, it's not for us.' Show me an editable taxonomy, a GBP base+bonus+profit-share offer, and a case-interview rubric, and I'll run a real pilot. Today it's a polished tool solving someone else's problem."
