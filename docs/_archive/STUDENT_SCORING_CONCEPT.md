# Students & fresh graduates — concept, answers, and gap analysis

> **Archived 2026-07-30.** Originally an assignment-prep Q&A document. The
> shipped mechanics it describes (archetype detection, provenance weighting,
> early-career dimension swap, fairness matrix, graduate-friendliness gate) are
> now verified and maintained in `docs/features/candidates/README.md` and
> `docs/features/matching/README.md`. Kept here for the fuller risk/trade-off
> narrative and the presentation run-of-show, which are not feature-doc
> material.

Prepared as the answer set for the assignment *"Platforma musí obsloužit i studenty a
čerstvé absolventy"* (~30 min presentation + discussion). Every claim below is
grounded in what is actually implemented on `main`; gaps are explicitly marked
**GAP** so the honest state is visible. Companion docs: `GRADUATE_FRIENDLINESS.md`
(job-side gate), `DEV_EXTENSION_PLAN.md` (dev-case module the interview reuses).

---

## Core thesis (the one-slide version)

> **BAU pipeline = extract & verify.** The CV is the signal; the interview verifies it.
> **Student pipeline = elicit & observe.** The CV is a thin prior; an agentic,
> case-grounded interview and a live work-sample **generate** the signal, and an
> evidence-provenance model keeps the thin prior honest instead of pretending it
> isn't thin.

Why BAU fails for students is structural, not cosmetic: with no track record,
provenance collapses (everything is coursework/self-declared), tenure-based
variables are undefined, and text similarity between a student CV and a JD written
for professionals is noise. The fix is not to make student data *look* experienced —
it is to change **what is compared and how much each piece of evidence is trusted**.

```
            STUDENT                                           BAU
  ┌────────────────────────┐                      ┌────────────────────────┐
  │ CV / apply / profile   │  thin prior          │ CV                     │  primary signal
  └──────────┬─────────────┘                      └──────────┬─────────────┘
             ▼                                               ▼
  archetype detection (signals, conf.)            archetype = bau
             ▼                                               ▼
  provenance-weighted skills                      provenance ≈ professional (1.0)
  (thesis .75, coursework .50, self .40)                     │
             ▼                                               ▼
  score: skills + POTENTIAL + motivation          score: skills + career + personal
  wide confidence band                            tight band
             ▼                                               ▼
  AI-designed case → case-grounded interview      interview verifies CV claims
  → mints OBSERVED evidence (1.0, capped conf)
             ▼
  band narrows; fairness matrix at compare time
```

---

## 1. Data a jejich sběr

### Jaké údaje budete od studenta potřebovat? Čím se liší od BAU?

The profile schema is **archetype-conditional** (`app/features/sub_profile/ProfileTypes.ts`,
`pipeline/jobfit/profile.py`):

| | BAU (required) | Student / switcher (required) |
|---|---|---|
| Track record | `years_experience`, `seniority` | — (not meaningful) |
| Education | optional | `education_detail` — programme, specialisation, **expected graduation** |
| Direction | derived from history | `aspirations` — explicit target roles |
| Evidence | jobs | typed evidence: `project`, `thesis`, `internship`, `course`, `extracurricular`, `certification`, `job`, `other` |
| Skills | claims (default provenance `professional`) | claims with **explicit provenance** (default `self_declared`) |

The key difference is not extra fields — it is that every piece of student
evidence carries a **kind** and a **provenance**, because that is what makes it
scoreable later (see §2). A brigáda outside the field still enters as
`kind: job` and contributes meta-signals (delivery, reliability) without faking
domain skills.

What we deliberately do **not** collect: GPA and course-by-course transcripts.
They are weak predictors, noisy across schools, and a bias vector; the
completeness checklist (below) prices in *what they did* (thesis, project,
activity), not *what grades they got*. This is a stated trade-off, not an omission.

### Jak bude vypadat uživatelské rozhraní / formulář? Co bude vyplňovat, co se odvodí automaticky?

Three intake paths exist today:

1. **Conversational apply** (`app/_lib/apply-intake.ts`, `app/_lib/apply.ts`) — 4
   questions (name, most relevant recent experience, skills, **"which best
   describes you"** archetype choice) + role-dependent KO questions. Universal
   for all archetypes.
2. **CV upload** (`app/api/analyze/route.ts` → `pipeline/jobfit/gemini.py`) — PDF/DOCX/TXT/MD;
   the LLM extraction is student-aware: it pulls structured `experiences` (incl.
   `thesis` and `project` kinds), skill claims **with provenance**, plus archetype
   signals (`is_enrolled`, `expected_graduation`, `education_is_dominant`,
   `wants_domain_change`, `has_substantial_experience`).
3. **Manual profile editor** (`ProfileEditor.tsx`) — full structured profile with
   archetype-conditional required fields and a provenance dropdown per skill claim.

**Filled by the student:** name, free-text experience/evidence, skills, archetype
self-declaration (optional), aspirations, education detail.
**Derived automatically:** archetype + confidence + reasons; provenance defaults
per evidence kind (`profile.py:45-54`); `years_experience` parsed from free text
(bilingual heuristic); a per-archetype **completeness score** — for early-career
the checklist weights `has_project_or_thesis` highest (2.0), then `has_aspirations`
(1.5), `education_detail` and `has_activity` (1.0) (`archetypes.json:30-35`).

**RESOLVED (2026-06-05):** both former intake gaps are closed. The apply flow now
**branches on the archetype answer** (asked right after the name): students get
project/thesis + education + aspirations questions, switchers get prior-field +
direction, the experienced lane is unchanged (`apply.ts` conditional steps,
`apply-intake.ts` lane mapping — a switcher's claimed skills deliberately do NOT
inherit professional provenance from the prior-job evidence). And CV upload now
drives a **completeness follow-up**: the pipeline emits the unmet checklist items
as structured gaps (`profile.completeness_gaps`), and the analysis banner renders
one targeted field per gap, merged into the profile on save
(`completeness-followup.ts`, `ArchetypeBanner.tsx`).

### Jak poznáte, že se jedná o studenta (a ne o zkušeného kandidáta)?

Detection is **data-driven and confidence-scored**, single-sourced in
`pipeline/jobfit/archetypes.json` (read by both Python and TS):

| Signal | Effect |
|---|---|
| `is_enrolled` | student **+2.0** |
| `expected_graduation` present | student +1.0 |
| years relevant experience < 1 | student +1.5 |
| `education_is_dominant` (education is the CV's center of gravity) | student +1.0 |
| years relevant experience ≥ 3 | bau +1.5 |
| `has_substantial_experience` | bau +1.0 |
| wants domain change (± substantial experience) | career_switcher +3.0 / +1.0 |

Rules of the game (`pipeline/jobfit/registry.py:114-166`):

- **Self-declaration wins** (confidence 0.9) — the apply form's archetype choice
  is trusted; heuristics are for CVs, which can't self-declare.
- Heuristic confidence = winning score / total; **contradictions lower it**
  (e.g. "student" with 3+ years relevant experience → 0.65).
- **Conservative default:** no signals → `bau` at 0.4 confidence. A misread in
  this direction is safe because early-career archetypes are fairness-protected
  (never auto-rejected), while the reverse misread (experienced scored as student)
  would inflate a weak profile.
- Confidence **< 0.55 flags the profile as unsettled for manual review** — the
  system says "I'm not sure" instead of guessing silently.

---

## 2. Zpracování a transformace dat

### Jak zajistíte, aby studentská data byla porovnatelná s inzeráty psanými pro zkušené kandidáty?

Four layers, and the direction matters: **we never rewrite the student's data to
sound senior; we change the comparison itself.**

1. **Shared skill taxonomy with hierarchy matching** (`pipeline/jobfit/taxonomy.py`).
   A thesis on "convolutional networks" and a JD asking "machine learning" meet in
   the same taxonomy: exact = 1.0, specialization = 0.9, generalization = 0.55.
   Stylistic mismatch between student text and JD text stops mattering once both
   sides are resolved to taxonomy terms.

2. **Provenance weighting** — the honest-credit mechanism. Every matched skill is
   discounted by *where it comes from*:

   | provenance | weight | | provenance | weight |
   |---|---|---|---|---|
   | observed | **1.00** | | personal_project | 0.70 |
   | professional | 1.00 | | extracurricular | 0.60 |
   | open_source / internship | 0.85 | | certification | 0.60 |
   | thesis | 0.75 | | coursework | 0.50 |
   | academic_project | 0.70 | | self_declared | 0.40 |

   A student's "Python (coursework)" is worth half a professional's "Python" — not
   zero, not equal. Crucially there is a path **up**: `observed` (skill
   demonstrated live in a case or case-grounded interview) outranks even
   `professional`. That is the equalizer: students can't have history, but they
   can be observed.

3. **The JD side is transformed too** (`GRADUATE_FRIENDLINESS.md`,
   `pipeline/jobfit/jobs.py`). Every job gets a deterministic
   `graduate_friendliness ∈ [0,1]` and an `is_entry_eligible` gate (junior title,
   ≤1y asked, or explicit early-career language); requirements carry
   `hardness: prerequisite | learnable`. Students are only matched against roles
   they can realistically land — comparability starts with not comparing against
   the wrong ads.

4. **Dimension swap in scoring** (`matching.py:534-578`). For early-career
   archetypes the `career` dimension (seniority/family fit — undefined for
   students) is replaced by **`potential_score`**, and `personal` (JD keyword
   overlap) by **motivation** (aspirations coherence + role-family hit + language).
   `potential_score` is a deterministic, explainable rubric over the evidence
   structure: 35 % depth + 25 % learning velocity + 25 % foundation + 15 %
   initiative (`transform.py`).

### Jaké přístupy nebo techniky použijete?

- LLM extraction with a **student-aware schema** (structured evidence + provenance
  + archetype signals), not generic CV parsing.
- Taxonomy resolution instead of text similarity for skill matching.
- **Elicited signal generation**: a six-phase agentic interview (22 min) scored on
  a BARS rubric, and an AI-designed work-sample case; both can **mint** `observed`
  evidence (details in §3).
- Hybrid LLM + deterministic everywhere an LLM is used: weight proposal, match
  reasoning, and interview-scenario generation all have deterministic fallbacks
  and bounded outputs — the LLM proposes, deterministic code constrains.

### Jak budete řešit chybějící data a nejistotu?

Principle: **missing data widens the uncertainty band; it is never imputed and
never silently zeroed.**

- Every match score carries a **confidence band** (`matching.py:494-531`): base
  spread 4, plus per-driver widening — early-career **without observed skills +6**
  (with observed only +2), fewer than 3 skills +6, unknown education +4, no
  languages +4, >2 missing must-haves +5. Bands are labeled `tight / moderate /
  wide` and each driver is a human-readable reason shown to the recruiter.
- Missing must-haves are **listed**, not guessed.
- Archetype uncertainty is explicit (confidence + reasons + manual-review flag).
- `potential_score` is clamped to [0,1] with tests proving malicious/out-of-range
  values cannot corrupt the 0–100 dial (`test_matching.py:310-337`).
- The interview-minting path refuses to mint from thin signal: a `wide`-confidence
  scorecard mints nothing (see §3).

---

## 3. Matching a scoring

### Jak se změní scoring pipeline? Co přidáte, co upravíte?

Same skeleton, five surgical changes:

| Stage | BAU | Early-career change |
|---|---|---|
| KO gate | seniority-gap check | replaced by **entry-eligibility** check (`matching.py:240-244`); student vs. senior-only role → clean KO with reason, not a low score |
| Skills | provenance-weighted match | same mechanism, different provenance mix; **`observed` minting** is the new input |
| Career dim | seniority + family fit (w 0.35) | **`potential_score`** (w 0.40) |
| Personal dim | JD keyword overlap (w 0.15) | **motivation** (w 0.20–0.25) |
| Weights | static archetype baseline | **bounded dynamic weights** + fairness matrix |

The two genuinely new mechanisms:

**a) Observed-evidence minting — the signal generators.** The dev-case module
designs a role-specific case (domain-neutral, with cover probes and a forced
decisions-log); the same case then powers two instruments:

- **Take-home work sample** (`live_case.py:observed_evidence`): transferred skills
  become `Evidence(provenance=observed)` only when `transfer_score ≥ 65`
  (the matcher's "promising" tier), confidence `min(0.95, score/100)`. Weak
  performance mints nothing — it never penalizes.
- **Case-grounded interview** (`live_case.py:observed_from_interview`): the
  six-phase script's middle phases (mechanism probes, counterfactual & transfer,
  coachability hint-injection) are instantiated **from the case material**
  (`devcase/interview_scenario.py`), so every candidate for a role works the same
  material live. Minting gates: scorecard confidence must not be `wide`, **every**
  case-fed construct rated on verbatim quoted evidence, mean ≥ 4.0/5; confidence
  capped at 0.9 — deliberately below the take-home's 0.95, because a live
  conversation is a lighter read than a full submission.

Both paths are closed end-to-end with tests: evaluation → evidence →
`build_match_candidate` marks skills observed → `score_job` narrows the
early-career band.

**b) Bounded dynamic weights + fairness matrix** (`matching.py:397-604`,
`weight_proposal.py`). An LLM proposes per-candidate weight adjustments
(calibrated across the whole pool in one call, with rationale), but: each weight
may move at most **±0.15** from the archetype baseline, clamped to [0.10, 0.60] —
no signal can erase a dimension. Guardrail in the prompt and the deterministic
fallback alike: weight responds to **evidence relevance/observed quality, not
presence** — having had access to an internship is not itself a merit. At compare
time the **fairness matrix** re-scores every candidate under every candidate's
weight scheme and ranks by cross-scheme mean; if the robust order diverges from
the headline order, the recruiter sees a divergence flag. Nobody wins just because
their own weights flatter them.

Pipeline-stage safety net: `student` and `career_switcher` are
**fairness-protected** — automation may never auto-reject (or auto-advance) them
at the screening stages (`app/_lib/archetypes.ts`, `pipeline-stages.ts`).

### Jak bude vypadat reasoning — jaké argumenty budou relevantní u studenta vs. zkušeného kandidáta?

Interview scoring uses **different rubrics per cohort**
(`interview-rubrics.json`): experienced keep the original 5 competencies
(technical depth, problem-solving, communication, experience & fit, motivation);
early-career are scored on **6 constructs with full 1–5 BARS anchors**: problem
decomposition, learning agility, coachability, conceptual depth, motivation &
direction, communication & collaboration. Every rating requires a **verbatim
transcript quote** as evidence; "not assessed" is a legal answer and blocks minting.

Match reasoning is archetype-conditional (`match_reasoning.py:74-215`):

| | Experienced | Student | Career-switcher |
|---|---|---|---|
| Frame | track-record verification | **judge on potential, not tenure** | **bridge narrative** |
| Strengths argued from | seniority, domain, family fit | project/thesis depth, learning trajectory, degree relevance, provenance read honestly | prior-domain professional maturity de-risks the switch; meta-skills credited at professional level |
| Gaps framed as | risks | **learnable** → junior/graduate track recommendation | new-domain hard skills "learnable but unproven" |
| Recruiter probes | depth follow-ups on claimed work | "walk one project end-to-end", "concrete example using skill X from your project" | "why switch now?", "ramp-up path?", "prior-domain leverage example?" |

Both early-career lenses are instructed to be **honest about uncertainty** — the
reasoning must say what is unknown, not paper over it.

---

## 4. Výstupy a UX pro recruitera

### Jak se studentský kandidát zobrazí recruiterovi? Bude odlišený od BAU?

Yes — separated, not just badged (`RecruiterCandidates.tsx:111-150`):

- The candidate list renders **two columns**: "Experienced" and "Early-career
  pipeline" (green-tinted). Students are never silently interleaved into a
  tenure-ranked list where they'd always sink to the bottom.
- Each card: archetype badge (Student / Switcher / Experienced) + inline
  **`potential X%`** for early-career.
- Matched skills carry **provenance badges** (`prod`, `intern`, `academic`,
  `self`, `OSS`, `cert`) — shown for early-career candidates only, where the
  distinction decides the score (`MatchCard.tsx:145`).
- Interview compare (`CompareInterviews.tsx`) renders each candidate against
  **their cohort's rubric** — students on the 6-construct potential rubric,
  experienced on theirs — with 1–5 color-coded ratings and quote evidence.
- Group evaluation (`GroupEvalModal.tsx:845-941`) shows the **fairness-check
  panel**: the cross-scheme matrix, per-candidate weight rationale, an
  "AI-tuned vs rule-based weights" pill, and the robust-order divergence flag.
- The About → Students page (`StudentsAbout.tsx`) documents the whole stance for
  users: overview, a synthetic 3-student worked scoring example (incl. which
  constructs are case-fed and how minting happened/failed), and the interview
  script with case-grounded vs personal phases marked.

### Jaké informace recruiter potřebuje, aby mohl studenta férově posoudit?

What the platform puts in front of them, mapped to the fairness need:

| Need | Surface |
|---|---|
| "How much is real?" | provenance badge per matched skill; observed > professional > … > self-declared |
| "How sure are we?" | confidence band (tight/moderate/wide) + named drivers |
| "What's the upside?" | potential score with its 4-component rubric, learning signals, aspirations |
| "Same bar for everyone?" | one designed case per role — every candidate works the same material; cohort rubric with BARS anchors + verbatim quotes |
| "Is the ranking robust?" | fairness matrix + divergence flag; weight rationale per candidate |
| "What should I ask?" | reasoning emits archetype-specific probes; debrief follow-ups minted per submission |

**RESOLVED (2026-06-05)** — the presentation caught up with the model:

- `provLabel` now renders **`observed` as its own moss-toned stamp** (it used to
  fall through to "academic" — the highest-trust provenance was mislabeled);
  interview-minted skills show as a "✓ observed: …" chip on the compare grid.
- Confidence-band **drivers render inline** on non-tight bands ("Why this band:
  Early-career — thinner record · <3 skills"), not tooltip-only.
- The compare table's evidence quotes are **visible in full** in the Evidence
  panel (every evidenced rating with its score chip), not capped at 3 hover-only.
- The early-career column header states the **fairness shield** in plain text
  ("scored on potential, never auto-rejected — adverse decisions stay human").

---

## 5. Rizika a trade-offy

### Kde vidíte největší rizika?

1. **The take-home alone is GPT-crushable.** Honest verdict from our own LLM test
   (real run on sentry/relay/snuba): analysis and probes are good, but a prose
   `repoSeed` + commit-metadata evaluation = essay-grading an LLM can ace.
   *Response shipped:* the submission is reframed as a **record of decisions**
   (every probe carries a decision space, a DECISIONS log is forced), evaluation
   mints 4–6 per-candidate authorship follow-ups, and a **submission-debrief
   interview** is the actual evaluation — scores are hypotheses, the live debrief
   verifies. *Closed 2026-06-05:* the **seed is now materialized** — the
   lifecycle turns `repoSeed` prose into a real bounded file tree (LLM +
   deterministic fallback, traps from the cover probes embedded, DECISIONS.md
   template included; `devcase/seed_materializer.py`, persisted per case).
2. **`potential_score` is an unvalidated heuristic.** Deterministic and
   explainable by design, but its weights (35/25/25/15) are judgment, not data.
   *Instrumentation shipped 2026-06-05:* every scorecard now carries
   deterministic call telemetry (hint offered/uptake classification, talk ratio,
   response-gap proxies — `interview-telemetry.ts`), and every submission bundle
   a process trace (commit cadence, decisions-log presence). These are honest
   proxies persisted per candidate, so weight validation against outcomes can
   start once outcomes accumulate. Until then we treat the score as a structured
   argument, not a measurement — which is also why it never gates anything alone.
3. **Archetype misclassification.** Mitigated by conservative defaulting (unknown
   → bau @ 0.4), the <0.55 manual-review flag, and fairness protection absorbing
   the dangerous direction. *Residual closed 2026-06-05:* transferable-skill
   extraction now follows the **scoring model**, not the `career_switcher` id —
   a misread switcher (or a student with an out-of-field brigáda) still earns the
   meta-skill credit their real prior role implies; and a passed work sample now
   feeds back into routing (bounded archetype-confidence lift, capped at 0.75 —
   below a self-declaration's 0.9).
4. **Interview-minted evidence overtrust.** A charming candidate could talk their
   way to `observed`. Mitigations: only the case-fed constructs count, every
   rating needs a verbatim quote, mean ≥ 4.0, wide-confidence scorecards mint
   nothing, and the confidence cap (0.9) keeps it below take-home evidence.
5. **LLM weight proposer drift/gaming.** Bounded simplex (±0.15, floor/ceiling),
   pool-level calibration in one call, deterministic fallback, explicit rationale
   shown to the recruiter, and the fairness matrix as the structural check.
   Candidate-list scoring stays deterministic; the LLM path is opt-in at group eval.
6. **Adverse-impact risk of "rewarding access".** Internship *access* correlates
   with privilege; the guardrail is explicit: weights respond to evidence
   relevance/observed quality, not presence, and the live case is the equalizer —
   `observed` is reachable with zero history.

### Jaké kompromisy jste udělali a proč?

- **Explainability over ML.** Deterministic rubrics + bounded LLM proposals
  instead of a trained ranker: no training data exists for this population, and a
  recruiter must be able to read every number's "why". We accept lower ceiling
  accuracy for full auditability.
- **Cost per candidate is higher** (a 22-min agentic interview + a designed case
  vs. a CV screen). Accepted because for this population the CV simply does not
  contain discriminating signal — cheap screening of noise is not cheaper.
- **Provenance discounting undervalues exceptional self-taught candidates** at
  first contact (self_declared = 0.4). Accepted because the observed-minting path
  exists precisely as their recovery route, and the alternative (trusting claims)
  breaks the whole comparability story.
- **A separate early-career column risks "second-class" optics.** We chose
  visible separation + an explicit fairness apparatus over silent interleaving,
  because interleaving on a tenure-flavored score is the *actually* unfair option.
  Framing everywhere: *different rubric, same bar*.
- **No GPA.** Loses a little signal in some markets; avoids a bias vector and
  cross-school noise. Evidence-of-doing beats evidence-of-grading.

---

## Bonus: kandidáti měnící obor (career switchers)

Not a bonus here — `career_switcher` is a **first-class archetype** sharing the
early-career scoring model:

- **Detection:** `wants_domain_change` (+3.0 with substantial experience, +1.0
  without) from CV extraction or self-declaration.
- **Transferable meta-skills** (`pipeline/jobfit/transferable.py`): prior-role
  titles map to domain-agnostic professional skills (teacher → communication,
  coaching; manager → leadership, delivery; analyst → analytical thinking,
  stakeholder management; any professional history → teamwork, communication,
  ownership, delivery baseline). These are credited at **professional**
  provenance — a switcher is not a blank-slate graduate.
- **Scoring:** weights 0.35 / 0.40 / 0.25 (lowest skills weight of all archetypes
  — their hard skills in the *target* domain are genuinely new and
  provenance-discounted like a graduate's), `potential_score` as the career
  dimension, fairness-protected, entry-eligibility KO.
- **Reasoning:** the bridge narrative — lead with how prior-domain maturity
  de-risks the switch; gaps framed as learnable-but-unproven; probes ask "why
  now", ramp-up plan, prior-domain leverage.
- **Same equalizer:** the designed case + case-grounded interview let a switcher
  demonstrate target-domain skill and mint `observed` evidence exactly like a student.

**RESOLVED (2026-06-05)** — all three former switcher gaps are closed:
**domain distance** is graded (`transferable.domain_distance`: adjacent /
moderate / far, from prior-role surface signals vs the target family — adjacent
lifts the potential foundation and shortens the narrated ramp, far keeps the
meta-skill bridge honest; threaded into the bridge-narrative reasoning as
`domainDistance`); **transferable-skill extraction is decoupled** from the
archetype id (gated on the scoring model — any early-career profile with real
prior job/internship evidence earns the credit); and **live-case/interview
results feed back into routing** (bounded archetype-confidence corroboration,
`live_case._corroborate_routing`).

---

## Gap & opportunity backlog — ALL SHIPPED 2026-06-05

| # | Gap / opportunity | Area | Resolution |
|---|---|---|---|
| 1 | **Completeness-driven intake follow-up** | Intake | `profile.completeness_gaps` (structured {check, label}, rides the analysis dump) → per-gap form fields in `ArchetypeBanner`, merged via `completeness-followup.ts` |
| 2 | **Recruiter-UX surfacing** | UX | `observed` provenance stamp (was mislabeled "academic"), "✓ observed:" chip on compare grid, inline band drivers on MatchCard, full evidence quotes in compare, fairness-shield note on the early-career column |
| 3 | **Student apply lane** | Intake | Archetype asked 2nd; conditional `when` steps (`stepConditionMet`/`nextVisibleStepIndex`): student → project/education/aspirations, switcher → prior field/direction; lane-aware profile assembly |
| 4 | **Materialized seed repo** | Dev-case | `devcase/seed_materializer.py` (LLM + deterministic, path-sanitized, capped, DECISIONS.md guaranteed) + `materialize-seed` CLI + lifecycle generation + `/api/devcase/seed/[id]` |
| 5 | **Instrument live case & interview** | Scoring | `interview-telemetry.ts` (hint offered/uptake, talk ratio, response-gap proxies) rides every scorecard; `processTrace` (cadence, decisions-log presence) rides every submission bundle |
| 6 | **Career-switcher depth** | Switcher | `domain_distance` gradation (adjacent/moderate/far) → potential + reasoning; transferable skills decoupled to the scoring model; passed cases corroborate routing (bounded confidence lift) |
| 7 | `STUDENT_SCRIPT_MIN` in scheduling/reminders | Wiring | `plannedInterviewMinutes(entry)` stamped on schedule invites (`duration_min`); picker, confirmation and reminder all state the planned length |
| 8 | Prep probes onto student script phases | Interview | `studentPrepRunOfShow`: early-career prep IS the six-phase script; CV hypotheses ride the personal phases only (case phases stay shared) |
| 9 | Take-home → observed TS wiring | Wiring | `observed-skills` CLI subcommand + `mintObservedFromSubmission` (promote-time, candidateRef resolved to a profile only when unambiguous) in orchestrator + promote route |
| 10 | Embedding bridge for personal/motivation | Scoring | `embedding_bridge.py` (Gemini, provider-pluggable, per-provider cache, fail-open) — opt-in via `recruiter_cli --embeddings`; group eval opts in, candidate list stays deterministic |

---

## Suggested 30-minute run-of-show

1. **The problem & thesis** (3 min) — why extract-and-verify collapses at zero
   experience; elicit-and-observe.
2. **Data & detection** (5 min) — archetype signals + confidence, the
   archetype-conditional profile, completeness checklist; demo: apply choice +
   CV-extraction signals.
3. **Comparability** (6 min) — taxonomy hierarchy, the provenance ladder
   (one slide: self_declared 0.4 → observed 1.0), graduate-friendliness gate,
   dimension swap; the "we transform the comparison, not the candidate" line.
4. **The signal generators** (7 min) — the case-designed interview: one case per
   role, six phases, three instantiated from the case; minting gates; live demo
   of the simulator's "Student — case-grounded" lane or the About → Example
   scoring tab (Adéla mints, Cyril doesn't).
5. **Fairness machinery** (4 min) — bounded weights, fairness matrix, divergence
   flag, never-auto-reject; GroupEval fairness panel screenshot.
6. **Risks & trade-offs** (3 min) — GPT-crushable take-home and the
   decisions-log/debrief response; unvalidated potential heuristic; the
   access-vs-merit guardrail.
7. **Bonus & roadmap** (2 min) — career switcher as a first-class archetype;
   the backlog table.
