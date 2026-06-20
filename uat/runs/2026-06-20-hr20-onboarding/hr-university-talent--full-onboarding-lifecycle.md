---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-university-talent
character_name: Dr. Susan Whitfield
role: HR Talent Manager — faculty + staff (large US public university, ~6,000 employees)
cert_level: L1
method: theoretical, code-grounded (NO browser)
language: en
---

# Dr. Susan Whitfield — L1 walk of full-onboarding-lifecycle

> Fit lens: a US public research university, ~6,000 employees, **two tracks** —
> **staff** (recruit normally on published pay grades) and **faculty** (a
> **search committee** decides under shared governance; HR is the EEO/compliance
> steward, never the picker). Anti-bias + **auditability** are paramount: an
> opaque ranking that creates disparate impact, or that overrides a committee, is
> a Title VII / OFCCP **and accreditation** liability. Comp is a **published
> rank/grade scale** in USD, not an inferred number.
> Central question per stage: does the output fit US higher-ed, or is it
> bank-/Czech-/IT-shaped?

## Per-stage walkthrough (in character)

**1. Post / ingest the role.** I open Jobs and try to post "Assistant Professor,
Biology, tenure-track" and "Research Lab Coordinator (staff grade 12)." The role
taxonomy (`data/taxonomy.json`) is entirely **software / data / product** — its
`role_family_votes` only ever route to `software_engineering`, `data_ai`,
`product_project` (:5-145). There is no teaching, research, academic, clinical,
or higher-ed-staff family anywhere. There *is* a `company_public_sector` type
with a salary factor of **0.80** (:154, :175) — but its rationale is literally
"Czech public-sector IT capped by **státní tarify** (state pay tables)," sourced
to platy.cz/expats.cz. So the one nod to my sector is a *Czech* state-pay
adjustment for *IT*, not a US university. My roles don't exist in this graph.

**2. AI match / shortlist.** The machinery is real (`match_reasoning.py` via
`/api/match/reasoning`). But the analysis it leans on forces a role family from
the IT-only set — the CV prompt instructs "Your role_family must be one of the
families above" (`gemini.py:435`), and there is no faculty family above. For my
faculty roles this is the wrong instrument entirely; for staff it could limp,
but a "research lab coordinator" will be force-fit into product/project. L1 can't
judge prose quality; the *structural* gap is the taxonomy.

**3. CV analysis / comp read.** This is where my world is rejected outright. The
Gemini prompt is a fixed string: *"You are a precise HR tech analyst for the
**Czech Republic technology market**"* and *"Salary numbers are monthly gross
**CZK** based on the current Prague/Czech tech market"* (`gemini.py:423,433`).
The anchor band (`data/salary_benchmarks.json`) is `"currency":"CZK"`, "Czech
Republic monthly gross salary, technology roles, 2026," with three IT families
and no others. The prompt takes **no industry / market / currency / jurisdiction
parameter** — I cannot tell it "US, higher-ed, USD annual." And the deepest
mismatch for me: the app **infers** a salary range at all. We don't. A faculty
or staff offer is the **posted scale for the rank/grade** — a public number I
look up, not a model's guess. An inferred CZK/month band is doubly wrong:
wrong-currency *and* wrong *mechanism*.

**4. Applicants in pipeline + consent.** The consent core is solid engineering
but **Czech-shaped**: `CONSENT_TTL_DAYS = 365`, anonymize-on-expiry, defaults
cited to **Recruitis/Sloneek** (Czech ATSs) and GDPR (`app/_lib/consent.ts:6-10`).
Good machinery for a regulator I don't answer to. My duties are FERPA (for
student-employee records), Title VII, OFCCP applicant-flow retention — none of
which this framing speaks to.

**5. Screening decisions (the make-or-break for me).** Mechanically this is the
best part: `runScreenWave` has a **dry-run preview** that commits nothing
(`screen-wave.ts:98-118,189-193`), every auto-reject is **sealed** into a
tamper-evident hash-chained record (`decision-record-store.ts:5-34,56-74`;
`sealDecisionSafe`, `screen-wave.ts:215-223`), and attribution is **three-state,
never silently AUTO** (`decision-attribution.ts:84-87`). Human-in-the-loop and an
audit trail genuinely exist — that clears two of my hardest bars.
**BUT** the fairness gate that protects candidates from automated rejection
shields exactly one thing: the **"early-career" archetype** (`student`,
`career_switcher` — `archetypes.json:21-53`, `archetypes.ts:62-68`,
`automation-fairness.ts:46-67`). It knows nothing of **race, sex, age 40+,
disability, or veteran status** — the actual protected classes EEOC adverse-impact
and my AAP track. There is **no adverse-impact / 4/5ths-rule lens anywhere** (grep
for EEOC/disparate/adverse across the app: zero hits in product code). An auto-
reject wave with no protected-class analysis is precisely the OFCCP-audit failure
I exist to prevent. The audit trail is excellent; what it audits is
fairness-blind to US law.

**6. Schedule + prep + rubric / 7. Group-eval.** The group-eval is where the tool
**overrides my governance model**. `runGroupEval` synthesizes a single AI
**"recommended lead,"** sorts the field, and **seals that pick into the decision
record** automatically — `kind:"group_eval_lead", actor:"auto:group-eval"`
(`group-eval-run.ts:356-360,402-412`). There is **no concept of a search
committee, multiple human evaluators, per-rater scores, or consensus** — it is
one model crowning one winner. For a *staff* req that's a documented-but-debatable
convenience. For a *faculty* search it is disqualifying: the committee makes the
collective decision under shared governance, and a sealed algorithmic "lead" on
tenure-track candidates is both a governance violation and a disparate-impact
exhibit waiting to be subpoenaed.

**8. Offer.** The offer page renders comp with **`currency ?? "CZK"`** as the
default (`app/offer/[token]/page.tsx:185-191`) and `offerView` returns a single
`salary` + `currency` (`offer-finalize.ts:156-166`). No rank/grade-scale concept,
no annual/USD default, no appointment-rank/term field for faculty. The plumbing
is clean and the **accept → onboarding** handoff is genuinely good (next stage).

**9. Onboarding hand-off.** The chain works end-to-end and is the strongest leg:
accept → `startRun` → `dispatchOnboarding` (`offer-finalize.ts:96-122`) → the
accepted token doubles as the onboarding link with an **inline CTA**, not a
dead-end (`offer/[token]/page.tsx:194-209`) → candidate questionnaire →
answers round-trip to the recruiter tab. And tasks **are editable** per template
(`coerceTasks`, `onboarding.ts:41-56`). But the `DEFAULT_ONBOARDING_TASKS` are
pure generic-office — contract / ID+tax+bank / equipment / accounts / buddy /
first-day / team-intro (:13-21) — with **no credentialing, no I-9, no
background/clearance, no benefits enrollment, no visa/J-1** step, and the entry
questionnaire is `preferredName/tshirtSize/dietaryNeeds/equipmentPrefs/
emergencyContact/startDateConfirm` (:25-32) — nothing higher-ed needs on day one.
The ceiling is soft (editable), but the out-of-box default is a full rebuild for me.

---

## L1 findings

```yaml
- id: HR20-SUSAN-01
  journey: full-onboarding-lifecycle
  character: hr-university-talent
  cert_level: L1
  type: trust
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Group-eval auto-seals a single "recommended lead" — no search-committee / multi-evaluator path; overrides faculty governance
  expected: >
    For a faculty-type role the AI must NOT rank-order or seal a "recommended
    lead." A committee makes the collective decision under shared governance; the
    tool should assist (blind packets, structured notes) and stay advisory, or
    offer a multi-evaluator/consensus path. HR could never put a sealed algorithmic
    pick in a faculty search file.
  got: >
    runGroupEval crowns one AI "lead" (top of a sorted field) and seals it into the
    tamper-evident decision record automatically (kind "group_eval_lead", actor
    "auto:group-eval"). There is no committee, multi-rater, per-evaluator-score, or
    consensus concept anywhere in the eval; it models hiring as one model picking
    one winner.
  expected_evidence_note: 'No committee/multi-evaluator concept exists — confirmed by absence.'
  got_evidence:
    - 'app/_lib/group-eval-run.ts:356-360'   # `lead` = single top pick
    - 'app/_lib/group-eval-run.ts:402-412'   # sealDecisionSafe group_eval_lead, actor auto:group-eval
    - 'app/_lib/group-eval-run.ts:18-29'     # comparative eval is one synthesized ranking
  evidence:
    - 'app/_lib/group-eval-run.ts:356-360'
    - 'app/_lib/group-eval-run.ts:402-412'
    - 'app/_lib/group-eval-run.ts:18-29'
  code_check: confirmed-absent   # committee/multi-evaluator path absent; single sealed lead present
  l2_priority: high   # confirm the modal presents the sealed lead as authoritative on the live app
  verdict: >
    A sealed algorithmic pick on candidates a committee is meant to deliberate is a
    governance + disparate-impact liability — blocker for faculty per severity
    arbitration (trust failure on a consequential AI action, no human-collective in loop).

- id: HR20-SUSAN-02
  journey: full-onboarding-lifecycle
  character: hr-university-talent
  cert_level: L1
  type: trust
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Auto-reject fairness gate protects only "early-career" — no protected-class / adverse-impact (EEOC/OFCCP) lens
  expected: >
    An automated screening wave at a US employer must apply a protected-class
    adverse-impact lens (race, sex, age 40+, disability, veteran) and/or a 4/5ths
    -rule check, and produce an AAP-ready record. At minimum it must disclose it
    does NOT do so.
  got: >
    The fairness gate shields exactly one thing from auto-rejection: the
    "early-career" archetype (student / career_switcher), failing closed only on
    UNKNOWN archetypes. It has no notion of protected classes and no adverse-impact
    / 4-5ths analysis anywhere in the app (grep for EEOC/disparate/adverse over
    product code returns zero). The audit trail is excellent but fairness-blind to US law.
  evidence:
    - 'pipeline/jobfit/archetypes.json:21-53'      # only student/career_switcher are fairnessProtected
    - 'app/_lib/archetypes.ts:39-68'               # FAIRNESS_PROTECTED is the early-career set
    - 'app/_lib/automation-fairness.ts:46-67'      # invariant = early-career + unknown only
    - 'app/_lib/screen-wave.ts:152-169'            # gate consults isFairnessProtected only
  code_check: confirmed-absent
  l2_priority: high
  verdict: 'A US auto-reject wave with no protected-class lens is an OFCCP/EEOC exposure — major minimum; effectively blocking for any role I would let it touch.'

- id: HR20-SUSAN-03
  journey: full-onboarding-lifecycle
  character: hr-university-talent
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Comp is an inferred Czech/CZK-monthly band — no published US rank/grade salary scale, no industry/jurisdiction input
  expected: >
    Higher-ed comp is the PUBLISHED scale for the faculty rank or staff grade
    (USD, annual) — a number HR looks up, not one a model infers. The analysis
    prompt should accept industry/market/currency, or comp should reference a posted scale.
  got: >
    The Gemini prompt is fixed to "precise HR tech analyst for the Czech Republic
    technology market" and "Salary numbers are monthly gross CZK based on the
    current Prague/Czech tech market"; the anchor band is CZK-only, Czech tech,
    three IT families. No market/currency/industry parameter; no concept of a
    posted scale. The very mechanism (infer a band) is wrong for higher-ed.
  evidence:
    - 'pipeline/jobfit/gemini.py:423'
    - 'pipeline/jobfit/gemini.py:433-434'
    - 'data/salary_benchmarks.json:2'              # "currency":"CZK", Czech tech market
    - 'app/offer/[token]/page.tsx:185-191'         # offer renders currency ?? "CZK"
  code_check: confirmed-absent
  l2_priority: high
  verdict: 'Wrong currency, wrong jurisdiction, and wrong mechanism (inferred vs posted scale) — headline AI output unusable for my comp world; major.'

- id: HR20-SUSAN-04
  journey: full-onboarding-lifecycle
  character: hr-university-talent
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: senior-quality
  title: Role taxonomy is IT-only (software/data/product) — no faculty/academic/research or higher-ed-staff families
  expected: >
    The taxonomy should carry my role families — teaching/research/academic
    (faculty) and higher-ed staff — or be extensible to them, so a shortlist and
    CV analysis fit my roles.
  got: >
    Every role_family_votes edge routes only to software_engineering, data_ai, or
    product_project, and the analysis forces "role_family must be one of the
    families above." A tenure-track professor or a research lab coordinator has no
    home family; faculty roles are unrepresentable, staff roles get force-fit.
  evidence:
    - 'data/taxonomy.json:5-145'                   # role_family_votes only the 3 IT families
    - 'pipeline/jobfit/gemini.py:435'              # "role_family must be one of the families above"
    - 'data/salary_benchmarks.json:6-30'           # only 3 IT families have benchmark bands
  code_check: confirmed-absent
  l2_priority: med
  verdict: 'My roles do not exist in the graph; faculty hiring has no instrument here — major against senior-quality/taxonomy fit.'

- id: HR20-SUSAN-05
  journey: full-onboarding-lifecycle
  character: hr-university-talent
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: trust
  title: Compliance/consent framing is GDPR/EU-AI-Act only — no US Title VII / OFCCP / FERPA framing
  expected: >
    A US public university needs framing for its regime (EEOC, OFCCP applicant-flow
    retention, FERPA for student-employees) — or at least neutral framing — not
    copy that implies an EU consent/anonymize regime.
  got: >
    Consent defaults are GDPR (CONSENT_TTL 365d, anonymize-on-expiry) citing Czech
    ATSs (Recruitis/Sloneek); the screening audit story is framed to EU AI Act.
    Strong, portable substance (human-in-loop + sealed audit + attribution), but
    single-jurisdiction framing that doesn't speak to my legal world.
  evidence:
    - 'app/_lib/consent.ts:6-10'
    - 'app/_lib/screen-wave.ts:8-13'
    - 'app/_lib/decision-attribution.ts:9-11'
  code_check: by-design
  l2_priority: low
  verdict: 'Substance (audit/human-gate/attribution) is sound and travels; the framing is mono-jurisdiction — minor for me because the bones are reusable, but it is not US-shaped.'

- id: HR20-SUSAN-06
  journey: full-onboarding-lifecycle
  character: hr-university-talent
  cert_level: L1
  type: missing-feature
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: low }
  dimension: missing
  title: Default onboarding tasks/questionnaire are generic-office — no credentialing / I-9 / clearance / benefits / visa
  expected: >
    A higher-ed default: I-9 + work authorization, credentialing / official
    transcript verification, background & clearance, benefits enrollment, and a
    visa/J-1 path for international faculty — plus a faculty appointment-letter step.
  got: >
    DEFAULT_ONBOARDING_TASKS = contract/ID+tax+bank/equipment/accounts/buddy/
    firstday/intro — no credentialing, I-9, clearance, benefits, or visa step. The
    entry questionnaire is preferredName/tshirtSize/dietary/equipmentPrefs/
    emergencyContact/startDateConfirm. Mitigant: templates ARE editable (coerceTasks),
    so the ceiling is soft.
  evidence:
    - 'app/_lib/onboarding.ts:13-21'
    - 'app/_lib/onboarding.ts:25-32'
    - 'app/_lib/onboarding.ts:41-56'               # editable — downgrades severity
  code_check: by-design   # editable per template; the default just isn't higher-ed-shaped
  l2_priority: low
  verdict: 'Editable, so minor — but the out-of-box default costs me a full rebuild for either track.'
```

## Strengths (what NOT to touch)
- **Auditable, human-gated screening** — dry-run preview commits nothing, every
  auto-reject is sealed into a tamper-evident hash chain, and attribution is
  three-state (never silently AUTO). This is genuinely the spine of a defensible
  decision record — I just need the *content* (adverse-impact) to match US law.
  (`screen-wave.ts:98-118,189-223`, `decision-record-store.ts:5-74`,
  `decision-attribution.ts:84-87`)
- **Accept → onboarding is a real next-step, not a dead-end** — accepted token
  doubles as the onboarding link with an inline CTA; questionnaire answers
  round-trip to the recruiter tab. (`offer-finalize.ts:96-122`,
  `offer/[token]/page.tsx:194-209`)
- **Onboarding templates are editable** — `coerceTasks` bounds + cleans custom
  tasks, so I *can* build a credentialing/I-9/clearance/visa checklist
  (`onboarding.ts:41-56`).
- **Blind-screening fails closed** — refuses to upload an un-redactable CV rather
  than leak identity (`gemini.py:405-413`). For blind faculty review, exactly the
  posture I want.
- **Fairness invariant fails closed on unknown archetypes** — a class it can't
  classify is shielded, not auto-rejected (`automation-fairness.ts:50-56`). The
  right default direction, even if the protected set is wrong for me.

## Per-journey verdict: **L1-fail**
The thread completes end-to-end with no dead-end or silent success, and the
audit/onboarding plumbing is genuinely strong. But for *my* world it has a
**blocker** (group-eval seals a single algorithmic "lead" with no
committee/multi-evaluator path — disqualifying for faculty governance) and three
**majors** that strike at the core of my mandate: no protected-class
adverse-impact lens on auto-rejection (EEOC/OFCCP exposure), comp inferred in
CZK/month with no posted-scale concept, and an IT-only taxonomy that can't
represent faculty or higher-ed staff. A structural gap that would expose the
university to a Title VII / OFCCP challenge is, for this Character, a fail-before-L2
— it must be fixed (or the tool scoped away from these decisions) before live
testing is meaningful.

## Grounding score per AI surface
(of {real CV, real JD, role/industry taxonomy, market/industry comp, company size,
jurisdiction, prior pipeline history, this Character's own data})

- **Match / shortlist reasoning** — ~4/8: real CV + JD + pipeline history reach it,
  but the taxonomy is IT-only and there is no higher-ed industry/jurisdiction
  framing, so a faculty/staff role is force-fit. (L2 to confirm prose.)
- **CV analysis / comp read** — **2/8**: real CV + JD only; comp is hard-coded
  Czech/CZK with no market, no jurisdiction, no industry, no company-size input,
  and no posted-scale mechanism. The weakest surface for me.
- **Screening / group-eval** — ~4/8: excellent pipeline/audit/attribution
  grounding, but the fairness *content* is early-career-only (no protected class),
  the governance model is single-picker (no committee), and the jurisdiction is EU.
- **Onboarding (deterministic, not AI)** — n/a for grounding; default content is
  generic-office but editable.

**Overall grounding: ~3.5/8.** Strong machinery fed the wrong domain on every axis
that defines my job — comp, taxonomy, bias law, and governance model are all
bank-/Czech-/IT-shaped. Exactly the "good machinery, wrong-domain context" defect
the journey predicts, and for a compliance steward it's the worst possible axis to
get wrong.

## Estimated time saved + adopt?
- **For STAFF, if comp/taxonomy/jurisdiction were settable and a protected-class
  lens existed:** plausibly **12–20 hrs saved per staff hire** — reasoned
  shortlist + human-gated, audited screen + a reusable onboarding template — past
  my <8-hrs/hire adoption line. *Confidence: medium* (L1; prose + latency
  unverified, and the comp/bias gaps are gating).
- **For FACULTY, as shipped:** **negative** value — the group-eval pre-ranks and
  seals a "lead" my committee is supposed to deliberate, so I'd spend time
  *fighting* the tool to keep it out of the decision, not saving any.
  *Confidence: high* (single-picker model confirmed in code).
- **As shipped overall: not adoptable.** The comp read is CZK/month, the bias
  gate ignores protected classes, and the eval overrides governance — three things
  Legal would stop at the door.
- **Adopt? No — L1-fail.** I'd pilot **staff screening + onboarding** the moment
  it (a) added a protected-class adverse-impact lens, (b) let me set US/USD and a
  posted-scale comp source, and (c) scoped the auto-"lead" away from faculty (or
  added a committee mode). The audit machinery is the reason I'd come back at all.

## First-person Character review (Dr. Whitfield's voice)
"I'll give it this: the screening keeps a human in the loop and writes down what it
did in a record I'd actually be comfortable opening in front of counsel — the dry-run
preview, the sealed trail, the careful 'who decided this, a person or the model.'
That's rarer than it should be, and it's the only reason I'm still reading.

But it was not built for a university, and on the axes that *are* my job it gets every
one wrong. It quotes me salary in Czech koruna per month — we post a public scale by
rank and grade; we don't let a model guess pay. It has no idea what a professor or a
research coordinator is; my roles aren't in its vocabulary. Its bias protection
guards 'early-career' candidates and has never heard of race, sex, age, disability,
or veteran status — which is to say it has never heard of the law I answer to. And
its 'group evaluation' crowns a single winner and *seals it* — on candidates a search
committee is supposed to deliberate together, under governance the faculty senate
would never let me hand to a model. That last one isn't a gap; it's a tool doing the
one thing I am paid to make sure no tool does.

Would I adopt? For staff screening and onboarding, the day it shows me an
adverse-impact lens, lets me set US dollars and our posted scale, and stays *out* of
the faculty decision — yes, and I'd bring it to my CHRO. Today, I couldn't get it
past Legal, and I wouldn't try. What's missing for my world: a 4/5ths / protected-
class analysis on every automated screen, a posted-scale comp source instead of an
inferred band, faculty/staff role families, a committee/multi-evaluator mode, and US
compliance framing. Until then I'd tell a peer the bones are good and the fit is
wrong — which, in higher-ed HR, means not yet."
