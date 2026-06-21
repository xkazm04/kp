# L1 — hr-pharma-ta-manager × full-onboarding-lifecycle

**Character:** Elena Rossi — Talent Acquisition Manager, scientific hiring · mid (~800) pharma/biotech · US / Boston · en
**Cert level:** L1 (theoretical, code-grounded, no browser)
**Fit lens:** PhD/scientist hiring where the signal is publications, patents, GxP/lab technique, therapeutic-area depth; niche long cycles; USD biotech comp with base+bonus+equity+sign-on; IP/GxP attestations at onboarding; the taxonomy must understand scientific roles.

---

## Per-stage walkthrough (in character)

**1. Post / ingest the role.** I open Jobs and try to post "Principal Scientist, Translational Oncology." The role family any JD resolves to comes from `pipeline/jobfit/taxonomy.py`, whose families are derived 1:1 from `data/salary_benchmarks.json` — and that file lists exactly three: `software_engineering`, `data_ai`, `product_project` (`salary_benchmarks.json:6-28`; families bound at `taxonomy.py:78-82`). There is no `research`/`scientist`/`clinical`/`regulatory` family. `data/taxonomy.json` is a wall of programming languages, cloud, devops, security — zero scientific terms (`taxonomy.json:4-168`); the only "scientist" token is `data_scientist`/`scientist` voting to `data_ai` (`taxonomy.json:104,106`). So my Principal Scientist gets classified as a data/AI or software person. *This was built for someone else's company.*

**2. AI match / shortlist.** The reasoning prompt's system role is literally **"a precise technical recruiter for the Czech tech market"** (`match_reasoning.py:23-25`). The context handed to the model is skills/years/seniority/role-family/education only (`match_reasoning.py:34-75`) — **no publications, no patents, no therapeutic area, no technique**. There is nowhere for "first-author Cell 2024" to enter the reasoning. Seniority is a `junior|medior|senior|lead` enum driven off years/title signals (`pipeline.py:883-898`), so my 2-years-out postdoc reads "junior."

**3. CV analysis / job-fit (Gemini).** The analysis prompt opens **"You are a precise HR tech analyst for the Czech Republic technology market"** (`gemini.py:423`) and the response schema (`gemini.py:28-113`) has **no field for publications or patents** — a scientist's entire signal has no home; it can only leak into freeform `evidence`/`traits`. Salary is hardcoded **CZK, monthly gross** (`gemini.py:78-86,433`; `pipeline.py:625-631`), anchored to the Czech `anchor_band` (`gemini.py:434`). The verified-skill trust gate (`pipeline.py:197-207`) is genuinely good — but it verifies *skills*, and my candidates' signal isn't skills.

**4. Applicants in pipeline.** Standard board + consent/AI-disclosure exists. Reachable, generic — fine structurally.

**5. Screening decisions.** Solid machinery: auto-reject only the bottom-% below a match threshold, a **fairness gate that fails closed** for early-career/unknown archetypes (`screen-wave.ts:8-13`), every decision audited with a rationale, and a clean **auto-vs-human attribution map** (`decision-attribution.ts:84-87`). But it ranks on a match score computed against a software taxonomy, and the audit framing is jurisdiction-neutral at best — nothing speaks to my **US/EEOC adverse-impact** regime specifically (it's also not EU-AI-Act-locked, which is the one mercy).

**6–7. Interview prep / group-eval.** Real-LLM, generic; rubric relevance to a wet-lab/clinical role is an L2 quality question, but the inputs feeding it carry no scientific signal, so I expect engineer-shaped probes.

**8. Offer.** The offer payload is a single scalar `salary` + `currency` (`offer-finalize.ts:161`), and the candidate page **defaults the currency to "CZK"** and renders **one number** (`offer/[token]/page.tsx:188-190`) — no base/bonus/**equity**/sign-on. A Boston biotech offer is unrepresentable. Accept does land on a concrete onboarding next-step inline (`offer/[token]/page.tsx:194-210`) — that part is clean.

**9. Onboarding hand-off.** Deterministic, and the **tasks are editable** (`coerceTasks`, `onboarding.ts:41-56`) — so I *could* add IP/GxP steps. But the defaults are pure generic-office (contract, ID, laptop, buddy, first-day; `onboarding.ts:13-21`) and the questionnaire is t-shirt-size/dietary (`onboarding.ts:25-32`) — **no IP assignment, no GxP/lab-safety, no conflict-of-interest** out of the box. The e-sign is an honestly-disclaimed audit-stamp seam, not eIDAS (`onboarding.ts:1-6`) — fair, named.

---

## Findings

```yaml
- id: HR20-PHARMA-01
  journey: full-onboarding-lifecycle
  character: hr-pharma-ta-manager
  cert_level: L1
  type: quality-gap
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Role taxonomy has no scientific family — every scientist routes to engineer/data/PM
  expected: A Principal/Senior Scientist, Research Associate, Computational Biologist, or Regulatory Affairs role classifies to a scientific/research family.
  got: ROLE_FAMILIES is derived solely from salary_benchmarks.json and is {software_engineering, data_ai, product_project}; data/taxonomy.json contains no scientific roles or lab/clinical terms. A scientist is forced into data_ai/software_engineering.
  evidence: ['pipeline/jobfit/taxonomy.py:78-82', 'data/salary_benchmarks.json:6-28', 'data/taxonomy.json:4-168']
  code_check: confirmed-absent
  l2_priority: low   # structurally certain at L1; L2 would only confirm the mis-classified prose
  verdict: For my roles the matching engine is mis-typed at the root.

- id: HR20-PHARMA-02
  journey: full-onboarding-lifecycle
  character: hr-pharma-ta-manager
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: CV extraction & match reasoning have no publications/patents/therapeutic-area signal
  expected: For a PhD CV, publications (first-author, impact factor), patents, therapeutic area, and bench/GxP technique are extracted as first-class evidence and weighed in fit reasoning.
  got: The Gemini analysis schema has no publications/patents field; match-reasoning context is skills/years/seniority/role-family/education only. A scientist's entire signal can only leak into freeform evidence/traits, unweighted.
  evidence: ['pipeline/jobfit/gemini.py:28-113', 'pipeline/jobfit/match_reasoning.py:34-75', 'pipeline/jobfit/match_reasoning.py:22-25']
  code_check: confirmed-absent
  l2_priority: high   # confirm whether freeform evidence ever surfaces a pub, and how the prose reads for a postdoc
  verdict: It reads engineers, not scientists — my hard trust line.

- id: HR20-PHARMA-03
  journey: full-onboarding-lifecycle
  character: hr-pharma-ta-manager
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Comp is CZK monthly-gross, cash-only, Czech-market-anchored — wrong currency, market, and structure for a Boston biotech offer
  expected: A USD biotech-market comp read carrying base + target bonus + equity (options/RSUs) + sign-on, with a basis.
  got: Salary prompt + schema hardcode CZK monthly gross anchored to the Czech anchor_band; the offer carries a single scalar salary and the candidate page defaults currency to "CZK" and shows one figure — no equity/bonus/sign-on.
  evidence: ['pipeline/jobfit/gemini.py:78-86', 'pipeline/jobfit/gemini.py:433-434', 'pipeline/jobfit/pipeline.py:625-631', 'data/salary_benchmarks.json:1-5', 'app/offer/[token]/page.tsx:188-190', 'app/_lib/offer-finalize.ts:161']
  code_check: confirmed-absent
  l2_priority: med   # confirm whether currency is overridable at offer-create; structure (equity/bonus) is absent regardless
  verdict: A monthly CZK number is meaningless on a Cambridge offer.

- id: HR20-PHARMA-04
  journey: full-onboarding-lifecycle
  character: hr-pharma-ta-manager
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: senior-quality
  title: Seniority is a years/title enum — a postdoc reads "junior", ignoring scientific maturity
  expected: A PhD/postdoc is judged on scientific output and potential, not raw industry years.
  got: Seniority resolves to junior|medior|senior|lead via current-level/years signals; "junior" is the entry floor. The archetype-routing layer (early-career/switcher) is the closest fairness mechanism but is keyed to study/tenure, not publication record.
  evidence: ['pipeline/jobfit/pipeline.py:883-898', 'pipeline/jobfit/match_reasoning.py:44-56']
  code_check: present-but-missed
  l2_priority: med
  verdict: My 2-years-out Nature first-author should not read junior.

- id: HR20-PHARMA-05
  journey: full-onboarding-lifecycle
  character: hr-pharma-ta-manager
  cert_level: L1
  type: missing-feature
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: missing
  title: Onboarding defaults are generic-office — no IP assignment / GxP / lab-safety / COI; editable but empty of them
  expected: Default (or one-click) onboarding tasks + questionnaire fields for IP/confidentiality assignment, GxP/lab-safety, controlled-substance, and conflict-of-interest attestations.
  got: DEFAULT_ONBOARDING_TASKS = contract/ID/laptop/accounts/buddy/first-day/intro; questionnaire = preferredName/tshirtSize/dietary/equipment/emergency/startDate. Tasks ARE editable (coerceTasks), so this is addressable — but nothing scientific ships, so it's manual per tenant.
  evidence: ['app/_lib/onboarding.ts:13-21', 'app/_lib/onboarding.ts:25-32', 'app/_lib/onboarding.ts:41-56']
  code_check: by-design
  l2_priority: low
  verdict: I can build it, but out of the box it forgets the one thing pharma can't skip.

- id: HR20-PHARMA-06
  journey: full-onboarding-lifecycle
  character: hr-pharma-ta-manager
  cert_level: L1
  type: confusion
  severity: minor
  impact: { frequency: low, reachability: high, trust_erosion: med }
  dimension: trust
  title: Compliance framing is bank/EU-shaped; nothing speaks to my US/EEOC adverse-impact regime
  expected: A screening audit/disclosure framed for, or at least neutral to, the hirer's jurisdiction (US/EEOC for me).
  got: Screening has a strong fail-closed fairness gate + audited rationale + clean auto/human attribution (a real strength), but no EEOC/adverse-impact framing; the product's compliance posture is EU/GDPR-leaning. It is NOT EU-AI-Act-locked, which limits the harm.
  evidence: ['app/_lib/screen-wave.ts:8-13', 'app/_lib/decision-attribution.ts:81-87']
  code_check: by-design
  l2_priority: low
  verdict: The machinery is fair; the paperwork isn't shaped for my regulator.
```

---

## Strengths (do not touch)
- **Verified-skill trust gate** (`pipeline.py:197-207`): AI-claimed matching skills are checked against real CV text and withheld if absent, surfaced as a review note — exactly the no-hallucination discipline I demand (it just doesn't apply to pubs).
- **Fail-closed fairness gate + fully audited screening** with a clean **auto-vs-human attribution map** (`screen-wave.ts:8-13`, `decision-attribution.ts:84-87`) — human-in-the-loop is real and accountable.
- **Honest seams named in code**: the e-sign audit-stamp-not-eIDAS disclaimer (`onboarding.ts:1-6`) and per-stage degrade-and-flag sanity notes (`pipeline.py:_softly`, `_salary_sanity_checks`) — I trust a build that flags its own limits.
- **Editable onboarding templates** (`coerceTasks`) mean the IP/GxP gap is fixable, not walled.
- **Accept lands on a concrete onboarding next-step** (`offer/[token]/page.tsx:194-210`) — no dead-end.

---

## Per-journey verdict: **L1-fail**
A blocker (no scientific role family → every scientist mis-typed at the root) plus two majors (no publications/patents signal; wrong-currency/market/structure comp) mean the headline AI outputs cannot represent my candidates or my offers. The thread *completes* mechanically, but the science-bearing AI surfaces fail my senior-quality and trust bars structurally — fix before L2.

## Grounding score per AI surface
Inputs scored against {real CV, real JD, role/industry taxonomy, market/industry comp, company size, jurisdiction, prior pipeline history, this Character's own data}.
- **Match/shortlist reasoning** — **2/8** (real CV-derived skills, real JD; taxonomy is wrong-industry, comp/jurisdiction/pubs/size absent). `match_reasoning.py:34-75`
- **CV analysis / job-fit (Gemini)** — **2.5/8** (real CV file + real JD; comp is wrong-market/currency, no pubs/patents field, jurisdiction = CZ-hardcoded). `gemini.py:28-113,423-434`
- **Salary read** — **1/8** (real seniority signal only; market, currency, structure all Czech-bank). `gemini.py:78-86`, `salary_benchmarks.json`
- **Screening decision** — **4/8** (real match/archetype/audit/human-in-loop; taxonomy + jurisdiction wrong-shaped). `screen-wave.ts`
- **Overall grounding for MY industry: ~2.4/8 — low.** Good machinery fed bank-/Czech-/software-shaped context.

## Estimated time-saved + adopt?
For a generic office/tech req the machinery would plausibly save real expert hours. **For MY scientific reqs: net ~0, possibly negative.** The output can't represent a publication, a patent, a postdoc's maturity, or a USD equity package, so I'd re-do every science-bearing read by hand to make it PI-safe — and re-doing on top of reading the tool's wrong-shaped output is slower than my own screen. **Confidence: high** (structural, not quality-dependent). **Adopt: no**, not for scientific hiring as-built.

---

## First-person review — Elena Rossi
I wanted to like this. The bones are honest in a way most ATSs aren't: it verifies a claimed skill against the actual CV instead of letting the model freelance, it keeps a human in the loop with an auditable, fail-closed fairness gate, and it flags its own seams instead of pretending. If I hired SDRs or data analysts in Prague, I'd take a serious look.

But it doesn't live in my world. My signal is a first-author paper, a patent, a therapeutic area, an assay someone owns — and there is *nowhere* in the extraction schema or the match reasoning for any of it; a Principal Scientist is classified as a "software_engineer" because those are the only families the taxonomy knows. The comp read is a monthly gross number **in Czech crowns**, cash-only — I can't put that in front of a Cambridge candidate who's weighing base, bonus, equity and a sign-on against three other biotechs. A two-years-out postdoc reads "junior." And the onboarding forgets IP assignment and GxP attestation — the two things a pharma new hire absolutely cannot skip — though at least I could add them, since the templates are editable.

Would I adopt it? No — not for scientific hiring, not as built. Would I tell a peer? I'd tell a tech recruiter in the EU to try it, and warn every life-sciences colleague that it's the wrong shape for us until it learns what a scientist is: a publications/patents/technique signal, a USD equity-bearing comp model, a real research role family, and an onboarding that knows IP and GxP exist. Fix those four and I'd run a real pilot.
