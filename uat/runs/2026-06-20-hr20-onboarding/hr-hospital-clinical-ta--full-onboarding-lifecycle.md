# L1 — Dr. Adaeze Nwosu (hr-hospital-clinical-ta) × full-onboarding-lifecycle

- **Character:** `hr-hospital-clinical-ta` — Clinical Talent Acquisition Director, US health system, enterprise ~12k, en
- **Journey:** `full-onboarding-lifecycle`
- **Cert level:** L1 (theoretical, code-grounded, NO browser)
- **Fit lens:** licensure/credentialing (state license, board cert, NPI, NPDB/malpractice), FCRA background + immunization, primary-source verification, severe nursing-shortage volume; AI screening of clinicians as an EEOC/Joint-Commission/FCRA compliance instrument. A wrong credential read is a patient-safety + legal event.
- **Reachable surface set:** authed workspace tabs (dev gate `kp_dev_authed=1`, `app/_lib/auth/devAuth.ts`) — Jobs, Library, Match, Analyze, Pipeline, Decisions, Schedule, Offers, Onboarding; candidate-facing AI-disclosure copy read-only. Seed is ČS bank/Czech (`env.md`); single-workspace lock (`app/_lib/workspace-lock.ts`) is a known ceiling on "my clinical data".

---

## Per-stage in-character walkthrough

**1. Post / ingest the clinical req.** I open Jobs and try to post "Staff RN — Medical-Surgical, day shift." The intake and JD machinery are real (`app/_lib/job-ingest.ts`, `app/features/sub_library/JdBuilder.tsx`), but the role *understanding* lives in `data/taxonomy.json`, and that file has no clinical vocabulary at all — every `role_family_vote` resolves to `software_engineering`, `data_ai`, or `product_project`. "RN," "med-surg," "BLS/ACLS," "compact license" are invisible terms. So the platform will *accept* my req text but cannot classify it; it'll be parsed as an unclassifiable office role. That's not a posting failure — it's a comprehension failure that will poison every downstream AI step.

**2. AI match / shortlist.** I run match reasoning. The deterministic scorer (`matching.py`) keys off the IT taxonomy, and then the LLM is handed a system prompt that opens *"You are a precise technical recruiter for the Czech tech market"* (`pipeline/jobfit/match_reasoning.py:23`). I am hiring nurses in a US hospital and the model has been told it is a Czech *tech* recruiter. The context payload (`reasoning_context`, :34) carries `roleFamily`, `skills`, `seniority`, `matchedSkills` — solid machinery — but the candidate's skills were matched against a taxonomy with no clinical terms, so "matched skills" for an ICU nurse will be near-empty or nonsense. A 20-year ICU veteran and a new grad both look like off-taxonomy noise. This is the exact failure mode I've been burned by.

**3. CV analysis / job-fit + salary.** Analyze runs real Gemini (`app/_lib/analyze-run.ts` → `pipeline/jobfit/pipeline.py`), which is genuinely good machinery. But the salary read is the tell: `pipeline/jobfit/salary_band.py` is hardcoded **CZK/month**, with a plausibility ceiling of `350_000` *CZK/month* (:33), and `data/salary_benchmarks.json` declares `"currency": "CZK"`, `"market": "Czech Republic monthly gross"`, with only three IT families and zero clinical bands. A US staff RN at ~$80k/year would either be flagged as garbage by the CZK ceiling or rendered as a koruna monthly figure. I cannot show the CNO a comp read in koruna.

**4. Applicants in pipeline + consent.** The pipeline board and drawer are real (`app/features/sub_pipeline/PipelineTab.tsx`), and there's a genuine GDPR consent lifecycle (`app/_lib/consent.ts`, `app/api/pipeline/[id]/consent/route.ts`) — given/expiry/anonymize, 12-month TTL, audit events. Good engineering. But it's *GDPR-shaped*: consent TTL, erasure, anonymization. My regime is **FCRA** (pre-adverse/adverse-action on the background check) and **EEOC/OFCCP** record-keeping — none of which this models. The consent machinery would mislead me into thinking I'm compliant when I've satisfied the wrong jurisdiction.

**5. Screening decisions.** The screen-wave (`app/_lib/screen-wave.ts`) is the most reassuring surface for me: human-in-the-loop is real (dry-run preview before commit, :115), every auto-reject is audit-sealed with a rationale + policy version (`sealDecisionSafe`, :215), and there's a fail-closed fairness gate (`isFairnessProtected`, `app/_lib/archetypes.ts:66`). That's the bones of a defensible record. **But** the fairness gate protects *early-career archetypes*, not EEOC **protected classes**, and there is no adverse-impact / 4-5ths analysis anywhere. Auto-rejecting "bottom X% by match score" — where match score came from a software taxonomy applied to nurses — is precisely how you manufacture disparate impact and can't defend it to the EEOC.

**6. Interview schedule + prep + rubric.** Scheduling/prep/rubric exist (`app/features/sub_schedule/ScheduleTab.tsx`, `app/_lib/interview-prep-run.ts`, `interview-rubric.ts`, `timezone.ts`). Timezone handling is a plus. The rubric, like the reasoning, is generated off an IT-shaped role model, so prep for an RN interview will probe the wrong things — but this is a softer, L2-quality concern.

**7. Group-eval / fair pick.** Real LLM group-eval with a fairness + sanity layer (`app/_lib/group-eval-run.ts`, `automation-fairness.ts`, `sanity-checks.ts`). Same caveat as screening: fairness here is archetype/score-spread fairness, not protected-class adverse-impact.

**8. Offer.** Offer page is solid and complete: accept lands on a concrete onboarding CTA (`app/offer/[token]/page.tsx:203-209`), deadline/expiry policy (`app/_lib/offer-policy.ts`), reminders. Currency is **configurable** — the page renders `offer.currency ?? "CZK"` (:189), so USD is expressible. Good. The default fallback being CZK is a minor tell, not a blocker.

**9. Onboarding hand-off.** The chain is real and well-built: accept → offer token doubles as onboarding token → candidate questionnaire → answers surface to the recruiter (`app/_lib/onboarding-candidate.ts`, `app/onboarding/[token]/page.tsx`, recruiter `OnboardingTab.tsx`). Templates **are editable** — `createTemplate(name, tasks)` runs everything through `coerceTasks` (`app/_lib/onboarding-store.ts:131`, `app/_lib/onboarding.ts:41`), so I *could* author a clinical checklist. **But** the out-of-box `DEFAULT_ONBOARDING_TASKS` (`app/_lib/onboarding.ts:13-21`) are pure generic office — "Order laptop and equipment," "Assign an onboarding buddy" — and the entry questionnaire (:25-32) asks **t-shirt size, dietary needs, equipment prefs**. There is **no** credentialing, immunization, NPDB, FCRA-background, or primary-source-verification step or field anywhere, and no clinical template to start from. For me the credential-verification tail *is* onboarding; here it's absent and I'd have to build it from a blank office checklist. The e-sign seam (`markSigned`) is honestly disclosed as audit-stamp-only, not eIDAS (`app/_lib/onboarding.ts:6`) — that honesty is a strength.

---

## L1 findings

```yaml
- id: ADAEZE-L1-01
  journey: full-onboarding-lifecycle
  character: hr-hospital-clinical-ta
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Match-reasoning LLM is hardcoded as a "Czech tech market" recruiter — clinical roles get a software-recruiter lens
  expected: For a US hospital RN req, the reasoning persona/lens fits clinical hiring (specialty, unit, license, bedside years), or is at minimum domain-neutral.
  got: The system prompt opens "You are a precise technical recruiter for the Czech tech market." Every shortlist rationale for a nurse is generated by a model told it is a Czech *tech* recruiter, against an IT-only taxonomy.
  evidence: ['pipeline/jobfit/match_reasoning.py:22-25', 'pipeline/jobfit/match_reasoning.py:34-75', 'data/taxonomy.json:4-168']
  code_check: confirmed-absent     # no clinical/role-domain switch on the persona; one fixed CZ-tech system prompt
  l2_priority: high               # confirm live: does the prose actually read tech-/CZ-shaped for a clinical CV, and does it drop a senior nurse below a new grad?
  verdict: major

- id: ADAEZE-L1-02
  journey: full-onboarding-lifecycle
  character: hr-hospital-clinical-ta
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Role taxonomy has zero clinical/healthcare vocabulary — RN/NP/CRNA/license/specialty are invisible
  expected: The taxonomy carries clinical roles, license types, and specialties so a nursing req classifies and matches on real clinical signal.
  got: taxonomy.json is exclusively software/IT/office (programming langs, cloud, devops, PM/agile) with three role families — software_engineering, data_ai, product_project. No clinical term exists; a nursing CV matches near-nothing and a senior clinician is indistinguishable from off-taxonomy noise.
  evidence: ['data/taxonomy.json:4-168', 'data/salary_benchmarks.json:6-28']
  code_check: confirmed-absent
  l2_priority: high
  verdict: major

- id: ADAEZE-L1-03
  journey: full-onboarding-lifecycle
  character: hr-hospital-clinical-ta
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Salary read is hardcoded CZK/month with a CZK plausibility ceiling — a US RN's USD/year comp can't be expressed in Analyze
  expected: Comp read in USD/year against a US clinical market (or settable to it) with a basis the CNO can see.
  got: salary_band.py pins SALARY_STEP and a 350,000 *CZK/month* plausibility ceiling; salary_benchmarks.json declares currency CZK, market "Czech Republic monthly gross", with only IT families. A US RN at ~$80k/yr is either ceiling-flagged as garbage or rendered as koruna/month. (Note: the *offer* page currency IS configurable — offer/[token]/page.tsx:189 — so the gap is the analysis layer, not the offer.)
  evidence: ['pipeline/jobfit/salary_band.py:20-33', 'data/salary_benchmarks.json:2-28', 'app/offer/[token]/page.tsx:189']
  code_check: confirmed-absent     # analysis salary layer is single-market CZK; no currency/market override on the band
  l2_priority: high
  verdict: major

- id: ADAEZE-L1-04
  journey: full-onboarding-lifecycle
  character: hr-hospital-clinical-ta
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: No EEOC adverse-impact analysis on automated screening; fairness gate protects archetypes, not protected classes — and no FCRA adverse-action flow
  expected: For a US employer, auto-screening exposes an adverse-impact (4/5ths) check and an FCRA pre-adverse/adverse-action path; the audit record is EEOC/OFCCP-defensible.
  got: The screen-wave has genuine human-in-the-loop (dry-run preview, sealed audit, fail-closed gate), but the gate shields *early-career archetypes* (isFairnessProtected) — there is no protected-class adverse-impact math and no FCRA adverse-action step anywhere. Auto-rejecting bottom-% by a score derived from an IT taxonomy is a textbook disparate-impact risk I couldn't defend.
  evidence: ['app/_lib/screen-wave.ts:149-209', 'app/_lib/archetypes.ts:62-68', 'app/_lib/screen-wave.ts:215-223']
  code_check: confirmed-absent     # fairness present but archetype-scoped; adverse-impact + FCRA absent
  l2_priority: med                # structural; L2 only confirms no hidden EEOC surface elsewhere
  verdict: major

- id: ADAEZE-L1-05
  journey: full-onboarding-lifecycle
  character: hr-hospital-clinical-ta
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: missing
  title: Onboarding has no clinical pre-boarding — default tasks/questionnaire are generic office; no credentialing/immunization/FCRA/primary-source step or field
  expected: A clinical onboarding path (or starter template) that sequences primary-source license/board/NPI verification, NPDB, FCRA background, and immunization/health clearance.
  got: DEFAULT_ONBOARDING_TASKS are office tasks (laptop, accounts, buddy, first-day plan); the entry questionnaire asks t-shirt size / dietary needs / equipment prefs. Templates ARE editable via createTemplate→coerceTasks, so I could hand-build a clinical checklist — but there is no clinical default, no credential field type, and credentialing is the binding constraint of my job. Editable-from-blank, not fit.
  evidence: ['app/_lib/onboarding.ts:13-21', 'app/_lib/onboarding.ts:25-32', 'app/_lib/onboarding-store.ts:131-137']
  code_check: present-but-missed   # editability exists (downgrades from blocker); clinical content + field types absent
  l2_priority: low
  verdict: major

- id: ADAEZE-L1-06
  journey: full-onboarding-lifecycle
  character: hr-hospital-clinical-ta
  cert_level: L1
  type: trust
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: trust
  title: AI disclosure + data-consent copy is GDPR-only; no FCRA/EEOC transparency framing for a US healthcare candidate
  expected: Candidate-facing AI/data disclosure that, for a US employer, also speaks to FCRA background-check consent and EEO use — not solely GDPR/12-month retention.
  got: AiDisclosure states "AI assists, a human decides" (a real strength for human-in-the-loop) but the data-consent variant is explicitly GDPR data-processing + 12-month retention + erasure; no FCRA/EEO framing. Satisfying the wrong jurisdiction can mislead a US employer into believing they're covered.
  evidence: ['app/_components/AiDisclosure.tsx:6-10', 'app/_lib/consent.ts:8-10']
  code_check: confirmed-absent
  l2_priority: low
  verdict: minor

- id: ADAEZE-L1-07
  journey: full-onboarding-lifecycle
  character: hr-hospital-clinical-ta
  cert_level: L1
  type: trust
  severity: minor
  impact: { frequency: low, reachability: high, trust_erosion: high }
  dimension: trust
  title: No "self-reported vs primary-source-verified" distinction on any credential/skill the system asserts
  expected: A clinical platform must distinguish a credential the CANDIDATE claimed from one VERIFIED at the source; presenting self-reported as fact is the core risk in my world.
  got: The pipeline carries skill provenance for early-career archetypes (academic/project vs professional, match_reasoning.py:49-51) — good DNA — but nothing models primary-source *credential* verification status, and an analyzed skill/credential is presented without a verified/self-reported flag. (Adjacent to ADAEZE-L1-02: there are no credentials in the taxonomy to flag in the first place.)
  evidence: ['pipeline/jobfit/match_reasoning.py:44-51', 'app/_lib/onboarding.ts:25-32']
  code_check: confirmed-absent
  l2_priority: low
  verdict: minor
```

---

## Strengths (what NOT to touch)

- **Human-in-the-loop screening is real and auditable** — dry-run preview before any commit, per-decision sealed records with policy version + inputs, fail-closed on unknown archetypes (`app/_lib/screen-wave.ts:115,160-162,215-223`). This is the right *shape* for a defensible decision; it just guards the wrong fairness axis for me.
- **AI disclosure exists and leads with "a human decides"** (`app/_components/AiDisclosure.tsx:21-28`) — the differentiator I'd want, even if the regulatory framing is wrong-jurisdiction.
- **Offer → onboarding chain is complete and currency-configurable** — accept lands on a concrete onboarding CTA, deadline/reminder policy, candidate questionnaire surfaces to the recruiter (`app/offer/[token]/page.tsx:203-209,189`, `app/_lib/onboarding-candidate.ts`). No dead-end here.
- **Onboarding templates are genuinely editable** (`createTemplate`→`coerceTasks`, `app/_lib/onboarding-store.ts:131`) — which is why the onboarding gap is "no clinical default," not "locked office checklist."
- **Honest seams** — the e-sign `markSigned` is openly documented as audit-stamp-only, not eIDAS (`app/_lib/onboarding.ts:6`); the build flags its own limits. Keep that honesty.
- **Skill-provenance DNA already exists** for early-career candidates (`match_reasoning.py:49-51`) — the bone structure to build credential provenance on.

---

## Per-journey verdict

**L1-conditional.** The completion thread holds end-to-end (post → match → analyze → pipeline → screen → schedule → group-eval → offer → onboarding) with no dead-end or silent-success on the surfaces I can reach — so it isn't an L1-fail. But it carries **five majors**, all the same root: *excellent generic machinery fed bank/Czech/IT-shaped context with no clinical or US-jurisdiction override*. None blocks the click-path; every one blocks me staking my license on the output. Majors carry forward to L2.

---

## Grounding score per AI surface

Inputs scored: {real CV, real JD, role/industry taxonomy, market/industry comp, company size, jurisdiction, prior pipeline history, this Character's own data}.

| AI surface | grounding | what's missing for me |
|---|---|---|
| Match / shortlist reasoning | **3/8** | real CV ✓, real JD ✓, pipeline history ~✓; taxonomy IT-only ✗, comp ✗, size ✗, jurisdiction ✗, my clinical data ✗ |
| CV analysis / job-fit (Gemini) | **3/8** | CV ✓, JD ✓, provenance DNA ~✓; clinical taxonomy ✗, US/clinical comp ✗, jurisdiction ✗, my data ✗ |
| Salary read | **1/8** | a band exists, but it's CZK/month, IT-family, single-market — wrong currency, market, and role family for me |
| Screening decision (screen-wave) | **4/8** | CV ✓, JD ✓, pipeline ✓, archetype-fairness ✓; EEOC adverse-impact ✗, FCRA ✗, clinical scoring ✗, my data ✗ |
| Interview prep / rubric | **2.5/8** | CV ✓, JD ✓; clinical role model ✗, jurisdiction n/a, my data ✗ |
| Group-eval / fair pick | **3/8** | CV ✓, JD ✓, fairness layer ✓; protected-class adverse-impact ✗, clinical lens ✗ |

**Overall grounding: ~2.8/8 for clinical/US-healthcare hiring.** The machinery is strong (often 8/8 *engineering*); the *context* it's fed is the wrong domain and the wrong jurisdiction for me.

---

## Estimated time saved + adopt?

**Estimate: net negative-to-neutral today; could reach ~50% screening time saved only after I rebuild the taxonomy, comp, compliance, and onboarding for clinical/US. Confidence: medium-high** (L1 code-grounded; the prompt persona, the CZK salary layer, and the office onboarding defaults are unambiguous in source).

As shipped, the screening shortlist would mis-rank my clinicians (IT taxonomy + CZ-tech persona), so I'd re-screen by hand anyway — and the comp read in koruna is unusable, so I'd redo it. That's slower than my 6am manual pass, which the rubric says is a major minimum on its own. **Adopt: NOT as-is.** Reconsider only with a clinical taxonomy, USD/year clinical comp, an EEOC/FCRA compliance layer, and a clinical onboarding/credentialing template — at which point the genuinely strong human-in-the-loop + audit + offer/onboarding bones would make it competitive.

---

## First-person Character-voice review

*Would I adopt this for my health system? No — not for a single clinical req, not yet.*

The bones are better than most of the "AI screening" pilots I've buried. A human signs every consequential decision, every auto-reject leaves a sealed record, the candidate is told AI was used, and the offer-to-onboarding handoff actually lands somewhere instead of "our People team will be in touch." If I were hiring software engineers in Prague, I'd take a hard look.

But I hire nurses in an American hospital, and this system doesn't know what a nurse is. The taxonomy is all Python and Kubernetes — there's no RN, no CRNA, no med-surg, no license. Worse, when it writes me a reason next to a candidate, it's doing it as *"a precise technical recruiter for the Czech tech market"* — those are its words, in the code. So it would rank my 20-year ICU charge nurse below a new grad who keyword-matched, which is exactly the malpractice I've seen tools commit before. The salary read comes back in koruna per month; I can't take a koruna number to my CNO for an $80,000-a-year RN. And the fairness gate protects "early-career," not protected classes — there's no adverse-impact check, no FCRA adverse-action letter — so if I let it auto-reject at volume, I'm one EEOC complaint from a very bad day, with a record that proves I used a score I can't explain. Onboarding starts with "order a laptop" and asks the new hire's t-shirt size; in my world onboarding *starts* with verifying the license at the source, and that step doesn't exist — I can build a checklist from blank, but nothing here knows credentialing is the job.

What's missing for *my* industry is everything that makes clinical hiring clinical: licensure and primary-source verification, board cert, NPDB, immunization, and a US compliance spine. The trust question is the one that decides it — *could I defend an automated decision to the EEOC and to a patient's family?* Today, no.

Would I tell a peer? I'd tell a fellow clinical TA director: "Strong engineering, wrong world. If they ship a clinical taxonomy, dollar comp, and an EEOC/FCRA layer, call me back." Right now it's a tech-recruiting tool wearing a hospital badge, and I won't put my license behind it.
