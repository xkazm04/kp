---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-healthcare-clinic-hrbp
character_name: Priya Nair
role: HR Business Partner (UK private clinic group, ~80 people)
cert_level: L1
language: en
verdict: L1-conditional
date: 2026-06-20
---

# L1 — Priya Nair · full-onboarding-lifecycle

> L1 theoretical walk over the code-derived surface model. No browser. Fit lens:
> UK private clinic — DBS / right-to-work / professional registration (NMC/GMC),
> NHS Agenda-for-Change banded pay in **GBP**, UK GDPR / CQC, small team. Central
> question at every AI surface: does the output fit a **UK clinic**, or is it
> **bank-shaped and Czech-shaped**?

## Spot-verified anchors (before judging)
- `data/taxonomy.json` — every role family is **IT** (software_engineering /
  data_ai / product_project); zero clinical terms (verified L1–L168).
- `pipeline/jobfit/salary_band.py:20-33` + `data/salary_benchmarks.json:1-29` —
  comp is **CZK/month, "Czech Republic … technology roles"**; bands are SWE/data/PM.
- `pipeline/jobfit/gemini.py:423,433` — analyst prompt hardcodes "for the Czech
  Republic technology market" and "monthly gross CZK … Prague/Czech tech market".
- `app/_lib/onboarding.ts:13-32` — default tasks + questionnaire are generic-office,
  frozen consts; `app/features/sub_onboarding/OnboardingTab.tsx:211-247` renders
  them with **no add/edit affordance**.
- `app/_lib/screen-wave.ts:1-251` — screening has a dry-run preview + audit seal +
  fairness gate, but the gate is **archetype/early-career**, not UK-protected-
  characteristic / clinical-registration aware.

---

## Per-stage walkthrough (in Priya's voice)

**1. Post / ingest the role.** I'd open Jobs and try to post "Registered General
Nurse, Band 5." The machinery is there, but the role taxonomy
(`data/taxonomy.json`) only knows software, data and product roles — there is no
nurse, HCA, GP, or "registration" concept anywhere in the graph. So my role gets
matched and scored against an **IT** role-family vote. That's not a polish gap;
it's the foundation being the wrong shape for my world.

**2. AI match / shortlist.** Good machinery — real LLM, transferable-skills
edges, reasoning that names CV facts. But it's fed an IT taxonomy and a Czech-tech
salary signal layer, so a nurse would be reasoned about as if she were an engineer.
I can't trust a shortlist that doesn't understand what a clinical role *is*.

**3. CV analysis / job-fit + salary read.** This is where I'd walk. The Gemini
prompt literally says "You are a precise HR tech analyst for the Czech Republic
technology market" and "Salary numbers are monthly gross CZK based on the current
Prague/Czech tech market" (`gemini.py:423,433`), anchored to a CZK band table with
no GBP, no Agenda-for-Change, and no override in my reach. A Band 5 nurse priced in
Prague koruna is worse than no number — it tells me the tool wasn't built for a clinic.

**4. Applicants in the pipeline + consent.** Consent / AI-disclosure plumbing
exists (`app/api/pipeline/[id]/consent/route.ts`) — good, that's an ICO-relevant
strength. I'd want to confirm at L2 the disclosure wording reads for a UK
candidate, not an EU AI-Act bank notice.

**5. Screening decisions.** Genuinely reassuring on the human-in-the-loop axis: a
dry-run preview that commits nothing (`screen-wave.ts:189-193`), a tamper-evident
sealed record (`:215-223`), per-row rationale, and a fairness gate that fails
*closed* (`:156-162`). But the gate protects "early-career / unknown archetype" —
it has no notion of my world's fairness frame or, more importantly, no clinical-
registration screening at all (it can't ask "is the NMC PIN active?").

**6. Interview schedule + prep + rubric.** Timezone handling exists
(`app/_lib/timezone.ts`); rubric generation is real-LLM. Fit risk is the rubric
leaning IT-competency; defer the prose-quality verdict to L2.

**7. Group-eval / fair pick.** Fairness + sanity checks present; reasonable for a
small shortlist. Same wrong-taxonomy caveat carries through.

**8. Offer.** The offer page renders comp with a default currency of **"CZK"**
(`app/offer/[token]/page.tsx:189`) and `offer-finalize.ts:161` passes through
`offer.currency` — so currency rides on the offer record, but there's no GBP /
banded-scale concept and the visible default is koruna. A Band 5 offer letter in
CZK is one I could never send.

**9. Onboarding hand-off.** The accept→onboarding chain is real and lands on a
concrete next step (`offer/[token]/page.tsx:203-209` inline CTA → `/onboarding/
[token]`), the candidate questionnaire bridges back to the recruiter
(`onboarding-candidate.ts`), and the e-sign seam is honestly flagged as audit-
stamped-not-eIDAS (`onboarding.ts:1-6`, amber note `OnboardingTab.tsx:255`) —
that honesty is a strength. **But** the default checklist is "send contract,
collect ID, order laptop, assign buddy" (`onboarding.ts:13-21`) with **no DBS, no
right-to-work, no NMC/GMC verification, no occupational health** — exactly the
gates that *are* onboarding for a clinic. Worse: the recruiter onboarding tab only
*toggles* tasks (`OnboardingTab.tsx:211-227`) and renders a frozen-const
questionnaire (`:235`, `ENTRY_QUESTIONNAIRE_FIELDS`) with **no UI to add a task or
a field**. The core lib *can* validate edited tasks (`coerceTasks`), so a template
is editable in principle through the store/API — but not from the surface I reach,
and the candidate questionnaire is a hard const with no override path at all.

---

## L1 findings

```yaml
- id: HR20-PRIYA-L1-01
  journey: full-onboarding-lifecycle
  character: hr-healthcare-clinic-hrbp
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Role taxonomy is IT-only — no clinical role families (nurse/HCA/doctor)
  expected: >
    The role/skill taxonomy that drives matching, role-family votes and salary
    anchoring can represent a UK clinical role (RGN, HCA, salaried GP) and the
    concept of professional registration.
  got: >
    Every term in the graph votes only into software_engineering / data_ai /
    product_project; there is no clinical role family, no registration concept.
    A nurse req is scored as if it were an engineering role.
  evidence: ['data/taxonomy.json:4-168', 'data/salary_benchmarks.json:6-28']
  code_check: confirmed-absent
  l2_priority: high   # confirm how badly a clinical CV mis-scores live
  verdict: blocks the "fits MY industry" bar; foundation is wrong-domain

- id: HR20-PRIYA-L1-02
  journey: full-onboarding-lifecycle
  character: hr-healthcare-clinic-hrbp
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Salary read is hardcoded CZK / Prague tech — no GBP, no Agenda-for-Change, no override
  expected: >
    A clinical pay read in GBP on the right NHS Agenda-for-Change band (or at
    least a settable market/currency), with a basis.
  got: >
    The Gemini analyst prompt is fixed to "the Czech Republic technology market"
    and "monthly gross CZK … Prague/Czech tech market"; the anchor band table is
    CZK SWE/data/PM bands; salary_band.py bounds CZK/month only. No GBP path, no
    banded-scale concept, no user override of market reachable.
  evidence:
    - 'pipeline/jobfit/gemini.py:423'
    - 'pipeline/jobfit/gemini.py:433'
    - 'data/salary_benchmarks.json:1-29'
    - 'pipeline/jobfit/salary_band.py:20-33'
  code_check: confirmed-absent
  l2_priority: high
  verdict: wrong-market comp; a Band 5 nurse priced in koruna is unusable

- id: HR20-PRIYA-L1-03
  journey: full-onboarding-lifecycle
  character: hr-healthcare-clinic-hrbp
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: missing
  title: Onboarding has no clinical compliance gates and the reachable UI can't add them
  expected: >
    Onboarding tasks AND the pre-boarding questionnaire are editable to express a
    clinic's real pre-employment gates (Enhanced DBS, right-to-work, NMC/GMC
    registration verification, occupational health) before day one.
  got: >
    Default tasks are generic-office (contract / ID / laptop / buddy / first-day)
    with none of the clinical gates. The recruiter onboarding tab only toggles
    existing tasks and renders a FROZEN-CONST questionnaire — no add-task / add-
    field affordance on the surface Priya reaches. The candidate questionnaire is
    a hard const (ENTRY_QUESTIONNAIRE_FIELDS) with no override path at all.
    (coerceTasks can validate edited tasks via the store/API, so templates are
    editable in principle — but not from her surface.)
  evidence:
    - 'app/_lib/onboarding.ts:13-21'
    - 'app/_lib/onboarding.ts:25-32'
    - 'app/features/sub_onboarding/OnboardingTab.tsx:211-227'
    - 'app/features/sub_onboarding/OnboardingTab.tsx:235-247'
    - 'app/_lib/onboarding-candidate.ts:40'
  code_check: present-but-missed   # task-editing exists in lib, not in reachable UI; questionnaire truly fixed
  l2_priority: high
  verdict: for a clinic this checklist is a safeguarding gap, not onboarding

- id: HR20-PRIYA-L1-04
  journey: full-onboarding-lifecycle
  character: hr-healthcare-clinic-hrbp
  cert_level: L1
  type: missing-feature
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: missing
  title: Offer comp defaults to CZK with no GBP / banded-scale concept
  expected: >
    An offer for a banded clinical role expressed in GBP on an Agenda-for-Change
    band.
  got: >
    The offer page renders the amount with a hardcoded "CZK" fallback; currency
    rides on the offer record but there is no UI/data concept of GBP bands. The
    visible default for a fresh offer is koruna.
  evidence:
    - 'app/offer/[token]/page.tsx:189'
    - 'app/_lib/offer-finalize.ts:161'
  code_check: present-broken   # currency field exists but defaults wrong-market with no banded model
  l2_priority: med
  verdict: downstream symptom of L1-02; an offer letter in CZK is unsendable

- id: HR20-PRIYA-L1-05
  journey: full-onboarding-lifecycle
  character: hr-healthcare-clinic-hrbp
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: trust
  title: Screening fairness/compliance framing is archetype + EU-AI-Act shaped, not UK clinical
  expected: >
    Screening is human-in-the-loop with candidate AI disclosure and an audit
    record framed for UK GDPR / CQC, and can reason about clinical registration.
  got: >
    Strong human-in-the-loop machinery (dry-run preview, sealed tamper-evident
    record, fail-closed gate). But the fairness gate is keyed to early-career /
    unknown-archetype, with no UK-protected-characteristic frame and no clinical-
    registration screening; consent/disclosure wiring is generic, not UK-clinical.
  evidence:
    - 'app/_lib/screen-wave.ts:156-162'
    - 'app/_lib/screen-wave.ts:189-223'
    - 'app/_lib/decision-attribution.ts:84-87'
  code_check: by-design   # solid generic compliance scaffold; just not jurisdiction-tuned to UK clinical
  l2_priority: med
  verdict: usable scaffold; the framing wouldn't satisfy a CQC-minded audit as-is
```

## Strengths (what NOT to touch)
- **Human-in-the-loop screening is excellent**: a preview that commits nothing,
  a tamper-evident sealed decision record, and a fairness gate that fails *closed*
  (`screen-wave.ts:156-162,189-223`). This is the spine of a defensible audit
  trail — exactly what a CQC-minded HRBP wants; it just needs UK/clinical framing.
- **Accept lands on a concrete next step**, not a dead-end — inline onboarding CTA
  on the offer page (`offer/[token]/page.tsx:203-209`) plus the candidate→recruiter
  questionnaire bridge (`onboarding-candidate.ts`).
- **The e-sign ceiling is named honestly** ("audit-stamped record, NOT itself
  eIDAS", `onboarding.ts:1-6`; amber UI note `OnboardingTab.tsx:255`). Honesty the
  build flags itself is a strength, not a defect.
- **Consent / AI-disclosure plumbing exists** (`app/api/pipeline/[id]/consent`),
  a real UK-GDPR-relevant foundation to build the clinical framing on.

## Grounding score per AI surface
Inputs scored: {real CV, real JD, role/industry taxonomy, market/industry comp,
company size, jurisdiction, prior pipeline history, *Priya's own clinical data*}.

| AI surface | grounding | note |
|---|---|---|
| Match / shortlist (`match_reasoning.py`) | **3 / 8** | real CV + real JD + history reach it; taxonomy/comp/jurisdiction/size all bank-IT-shaped; her data unrepresentable |
| CV analysis + salary (`gemini.py`, `salary_band.py`) | **2 / 8** | real CV + JD reach the prompt; market/comp/jurisdiction hardwired to CZ tech; no clinical taxonomy |
| Screening (`screen-wave.ts`) | **4 / 8** | strong audit + history + HITL; jurisdiction/industry/registration framing absent |
| Interview prep/rubric | **3 / 8** | (L1 estimate — defer prose to L2) real role/CV; rubric likely IT-competency-leaning |
| Onboarding (deterministic) | **2 / 8** | generic-office tasks; no clinical gates; candidate questionnaire fixed |

**Overall grounding: ~2.8 / 8 for THIS Character.** The machinery is real and
well-built; it is fed bank/Czech/IT context she cannot override from her surfaces.

## Per-journey verdict
**L1-conditional.** The thread structurally completes end-to-end (no dead-end, no
silent success — actions confirm and seal), so it's L2-eligible. But it carries
**three majors** (IT-only taxonomy, CZK/Prague-tech comp, no clinical onboarding
gates) that mean every headline AI output is wrong-domain for a UK clinic. These
carry forward to L2; they are the difference between "it ran" and "I'd put my name
on it."

## Estimated time-saved + adopt?
- **Estimate:** On shortlisting/screening alone the HITL + reasoning machinery
  could plausibly take my ~8–12 pipeline hours toward ~3–4 — *if* the taxonomy and
  comp understood clinical roles. As shipped, the wrong-domain output forces me to
  redo the fit and comp judgement by hand, and the onboarding can't hold my
  compliance gates, so the net saving collapses to roughly the résumé-reading
  time only. **Confidence: medium** (L1 over code; real prose quality is L2).
- **Adopt? Not yet.** The spine (audit, HITL, accept→onboarding) is genuinely
  good and I'd *want* to adopt it — but not while comp is in koruna, roles are
  IT-only, and onboarding can't track a DBS. **Conditional adopt** once it's
  settable to GBP/Agenda-for-Change, carries clinical role families, and lets me
  add Enhanced DBS / right-to-work / NMC-GMC / OH to onboarding.

## Character-voice review (first person — Priya)
"I'll give them this: the screening is the most honest I've seen — it shows me
exactly what it *would* do before it does it, seals a record I could put in front
of an inspector, and refuses to auto-reject when it isn't sure. And accept doesn't
dead-end; it hands the new starter a real next step. That's the bones of something
I'd run a clinic on. But it wasn't built for *my* clinic. It thinks every job is a
software job — there's no nurse, no HCA, no GP, no concept of a registration
number anywhere. It quotes me pay in Czech koruna for a Band 5 role, on a Prague
tech market, with no way to switch to pounds or to Agenda for Change. And the
onboarding checklist tells me to order a laptop and assign a buddy but never to do
the **Enhanced DBS**, the **right-to-work** check, or to **verify the NMC PIN** —
and on the screen I actually use, I can't even add those. For a CQC-registered
clinic, a checklist that can't hold a DBS isn't onboarding, it's a safeguarding
gap. What's missing for my world: clinical role families, GBP banded pay, and
editable compliance-gate onboarding. Would I tell a peer? I'd say: 'great engine,
brilliant audit trail — wait until it speaks pounds and knows what a nurse is.'"
