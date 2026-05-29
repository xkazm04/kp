# kp v2 — Comprehensive plan

> **Purpose.** Two things at once:
> 1. A **build plan** we execute across multiple sessions to turn the current single-analysis
>    app into a real **matching platform with student / early-career support**.
> 2. A **direct answer to the 2nd-round AI-Architect brief** — every question in *"Vaše zadání"*
>    is answered in §6 (students) and §7 (career-switchers).
>
> Visual companion: [`diagrams/`](diagrams/) (PlantUML). Diagram numbers are referenced inline as **[Dxx]**.
> Decisions taken with the team: **full platform + student mode**, **seed a synthetic job DB**,
> **English docs/code, Czech-ready presentation**.

---

## 0. Table of contents

1. Executive summary
2. Where v1 stands vs. the brief (gap analysis)
3. The core problem — why BAU fails for students
4. v2 architecture overview
5. Making the BAU matching platform real
6. Student / early-career solution (the brief, answered)
7. Bonus — career-switchers
8. Data model & contract changes
9. Phased roadmap (multi-session)
10. Evaluation & fairness
11. Risks, trade-offs, open decisions
12. Presentation narrative (30-min walkthrough)

---

## 1. Executive summary

The current app (**v1**) is a deep **single-candidate analyzer**: one CV (or ≤3 variants) →
optionally one JD + company + GitHub → **one Gemini call** → profile, score breakdown, salary,
job-fit, interview kit, persisted to SQLite. It is excellent at *depth on one pair* but is **not**
the candidate→thousands-of-jobs **matching platform** the brief assumes already exists.

**v2** delivers that platform and then solves the actual task — students/graduates — on top of it:

- **Realize BAU matching** — structured **job-ad ingestion** at scale, a **skill-taxonomy graph**
  (aliases **+ hierarchy + provenance**), and a **3-layer matching engine** (cheap KO filters →
  deterministic multi-factor scoring → cached LLM reasoning on the top-N). **[D02, D05, D06]**
- **Add an archetype router** — every candidate is routed to **BAU / Student-Early-Career /
  Career-Switcher**, which selects the intake, the transformation, the scoring weights, and the
  reasoning lens. **[D07]**
- **Solve the student gap** with one central idea: **translate to a shared representation**.
  Student artifacts (projects, thesis, coursework) are normalized into the *same* competency
  vocabulary the JDs use; "years of experience" is replaced by a **potential/readiness model**;
  JDs are **reinterpreted to entry terms**; and residual uncertainty is carried as an explicit
  **confidence band** rather than faked as zeros. **[D08, D09, D10]**
- **Make it fair for recruiters** — archetype badges, **evidence provenance**, a potential score,
  surfaced assumptions, and a fair-comparison lens so a structurally-low experience number is not
  read as a red flag. **[D11]**
- **Reuse the machinery for career-switchers** by adding a **transferable-skill mapper**. **[D12]**

The guiding principle throughout: **never silently compare things that aren't comparable** —
make the translation, the provenance, and the uncertainty explicit at every layer.

---

## 2. Where v1 stands vs. the brief (gap analysis)

The brief describes a "BAU pipeline" as if it exists. Mapping it to the actual code:

| Brief's BAU capability | v1 reality (file) | Gap → v2 work |
|---|---|---|
| **1. CV → structured profile** | ✅ `gemini.py` + `pipeline.py::_profile_from_payload`; user can review in Extraction tab | Extend intake to portfolio/links; decouple profile from a single analysis |
| **2. Job-ad processing at scale (thousands)** | ❌ JDs are **raw text blobs** in `jds` table; no structured requirement extraction | **Build job ingestion** [D05]: requirements (must/nice × hard/learnable), normalization, entry-lens |
| **3. Skill taxonomy w/ aliases + hierarchy** | ⚠️ `taxonomy.json` is a **flat** term graph — aliases ✅, **hierarchy ❌** (no SwiftUI ⊂ Swift) | Add hierarchical edges + a **provenance** dimension to taxonomy |
| **4a. Hard KO filters** | ❌ none — there is no candidate→corpus filtering at all | **Build KO-filter layer** [D06] (location, mode, seniority floor, language, education, auth) |
| **4b. Multi-factor scoring (skills / career / personal fit)** | ⚠️ a single Gemini `score` (experience/skills/role_seniority/education/traits) for **one** pair | **Build a real scorer** over the surviving corpus; archetype-specific weight profiles |
| **5. LLM reasoning, cached** | ✅ `job_fit` narrative + `gemini_cache` (input-hash) | Re-key cache **per candidate × job**; reasoning becomes top-N only |
| **Student / graduate support** | ❌ experience-centric scoring actively penalizes thin profiles | **The headline of v2** — §6 |
| **Career-switcher support** | ❌ | **Bonus** — §7 |

**Key structural observation.** v1's scoring axes are *experience-weighted* (`experience` 0–25,
`role_seniority` 0–23). For a student these two collapse to near-zero, dragging the total down even
when the candidate is a great entry hire. This is not a tuning problem — it needs a **different
scoring profile**, which is why the **archetype router** is the spine of v2.

---

## 3. The core problem — why BAU fails for students

Restating the brief sharply, because the solution follows from the diagnosis:

> Student CVs and experience-oriented JDs **speak different languages.** v1 compares CV text ↔ JD
> text (keyword overlap + LLM on raw text). For students that comparison is structurally weak:
>
> - **No/low relevant experience** → the experience & seniority axes are empty.
> - **Different information type** → school projects, thesis, study focus, off-field part-time jobs,
>   student activities — none of which the experience-oriented pipeline knows how to value.
> - **Non-indicative standard variables** → "years of practice", "seniority", "domain" are missing
>   or misleading.
> - **Stylistic & content mismatch** → a JD says "3+ years React in production"; a student says
>   "used React in my semester project" — semantically related, lexically and contextually distant.

**Three things must change** to fix this, and they define §6:

1. **Capture different data** (you can't value what you didn't collect) — §6.1.
2. **Translate both sides to a common representation** (the bridge) — §6.2.
3. **Score & reason on the right axes with honest uncertainty** — §6.3, and present it fairly — §6.4.

---

## 4. v2 architecture overview  **[D02, D03]**

The platform is organized as **stores + pipelines + an archetype-routed matching engine**:

- **Stores** — `candidates · profiles · evidence`, `jobs · requirements · entry_profiles`,
  `matches · reasoning`, plus an **embedding index** for the semantic bridge. (SQLite for the demo;
  the shapes are the contract, not the engine.)
- **Job ingestion pipeline** [D05] — turns raw ads into structured, normalized, entry-classified jobs.
- **Archetype router** [D07] — classifies the candidate and selects the downstream profile.
- **Transformation** [D09, D12] — evidence normalizer (+provenance), potential model, transferable-skill mapper.
- **Matching engine** [D06] — the **same 3-layer skeleton** (KO → score → reason) for every
  archetype; only the **filter gates, scoring weights, and reasoning lens** swap by archetype.
- **Skill taxonomy graph** — single source of truth for matching, now hierarchical and provenance-aware.

The 3-layer skeleton is deliberately uniform: it keeps cost down (cheap filter → mid scorer →
expensive LLM only on the top-N), and it means the student/switcher work is a **configuration of an
existing engine**, not a parallel system to maintain.

The domain model **[D03]** makes the archetype a first-class field on `CandidateProfile`, adds
`Provenance` and `confidence` to every piece of `Evidence`/`SkillClaim`, splits each
`JobRequirement` on `kind` (must/nice) **and** `hardness` (prerequisite/learnable), and gives every
`Job` a precomputed `JobEntryProfile` (the "junior lens"). A `Match` stores per-dimension scores, a
**confidence band**, and which `scoringProfile` produced it.

---

## 5. Making the BAU matching platform real

This is the substrate the student work sits on. Three pieces:

### 5.1 Job-ad ingestion  **[D05]**
- LLM extraction of base fields + **structured requirements**, each tagged `must/nice` and
  `prerequisite/learnable`.
- **Normalize** every skill to a taxonomy node (k8s→Kubernetes), attaching hierarchy parents.
- **Entry/graduate lens, precomputed once per job**: `isEntryEligible`, a `graduateFriendliness`
  score, and **reinterpreted must-haves** ("3y React" → "demonstrated React foundation") with each
  must marked prerequisite-vs-learnable. This is what makes an experience-oriented corpus usable for
  students *without rewriting the ads*.
- Cache by content hash; build a role-description embedding.
- **Demo data:** seed a few hundred synthetic Czech-market ads spanning role × seniority × mode ×
  location, including genuinely entry-friendly and genuinely senior-only postings.

### 5.2 Taxonomy graph upgrade
- Add **hierarchical edges** (`parent-of`: SwiftUI⊂Swift, FastAPI⊂Python-web) so a foundational or
  adjacent skill counts as a **partial** match instead of a miss — essential for thin student profiles.
- Add a **provenance/confidence** dimension so "React, 5y production" and "React, one school project"
  are not treated as identical evidence.

### 5.3 The 3-layer matching engine  **[D06]**
- **Layer A — KO filters (cheap, DB-side):** location/distance, work mode, seniority floor, min
  education, languages, work authorization. Narrows thousands → ~hundreds.
- **Layer B — multi-factor scorer (deterministic):** skills match (taxonomy + hierarchy + embeddings),
  career fit (history ↔ role), personal fit (summary/values ↔ team/culture) → weighted total + rank.
- **Layer C — LLM reasoning (top-N, cached per candidate × job):** verdict, strengths, gaps,
  interview probes. Cache re-keyed from v1's single-pair hash to a `(candidateId, jobId, PROMPT_VERSION)` key.

> Student and career-switcher modes (§6, §7) **reuse this exact skeleton** — they swap the Layer-A
> gates, the Layer-B weights, and the Layer-C lens. That reuse is the architectural payoff.

---

## 6. Student / early-career solution — the brief, answered

### 6.1 Data & collection  **[D07, D08]**

**What we need from a student (and how it differs from BAU).** BAU mines a rich CV; students rarely
have one, so we **invert the flow**: auto-extract what exists, then **guide** them to surface signals
the pipeline can use. New/emphasized fields vs BAU:

| Signal | Why it matters for a student |
|---|---|
| Education detail — program, **specialization**, year/expected graduation, key courses | The dominant evidence block; domain relevance proxy |
| **Thesis / final work** — topic, methods, tools, abstract | Often their deepest, most real piece of work |
| **Projects** (school / personal / hackathon) — role, tech, **link**, outcome, team size | The primary substitute for job history |
| Internships / part-time — **incl. off-field** | Transferable skills + first professional signals |
| Extracurriculars — clubs, competitions, open-source, tutoring | Initiative, teamwork, leadership evidence |
| Certifications / online courses | Self-driven learning signal |
| **Aspirations & preferences** — target roles, interests, willingness to learn, location/remote, **availability**, languages | Replaces "current role/seniority"; drives motivation-fit & KO |
| Self-rated skills (**explicitly flagged self-declared**) | Low-trust signal, validated later by interview probes |

**What's auto-derived vs entered.** Auto: name/contact, education, links, any extractable skills
(from CV/LinkedIn/GitHub). Entered/confirmed: project details, thesis, aspirations, availability,
self-ratings. A **completeness model** drives the ask order ("your biggest missing signal is …").
We **prioritize verifiable artifacts** (GitHub/demo/thesis links) over self-rated levels.

**How we know it's a student.** The **archetype router [D07]** combines: explicit self-declaration in
the form (primary), enrollment status / expected graduation, ~0 years *relevant* professional
experience (off-field part-time excluded), education-block dominance, and recency of study. It emits
an **archetype + confidence**, the candidate gets a **one-click override**, and the recruiter sees
both — routing is a *suggestion*, never a silent verdict.

### 6.2 Processing & transformation — the bridge  **[D09]**

The central architectural move: **translate both sides into a shared representation**, then compare.

1. **Evidence normalization (+ provenance).** Map every artifact to the *same taxonomy nodes the JDs
   use*; attach `provenance` (academic_project / thesis / coursework / internship / self_declared / …)
   and a `confidence`. "React app for my thesis" → `{React, frontend, REST}` + `provenance: THESIS` +
   `confidence: medium (has GitHub link)`.
2. **Potential / readiness model (replaces years-of-experience).** A composite of demonstrated skill
   depth (did they *ship*?), learning velocity (self-taught stacks per semester), foundation quality
   (degree ↔ target domain), and trajectory/initiative (hackathons, OSS). Outputs `potentialScore` +
   `learningSignals`, mapping to an entry band **with a high-potential flag** so a standout isn't
   filtered into mediocrity.
3. **JD reframing (meet the job halfway).** Use the precomputed `JobEntryProfile` so the student is
   compared against **reinterpreted** musts and gaps are split **prerequisite vs learnable**.
4. **Missing data & uncertainty — explicit, not zeroed.** Distinguish **evidence of absence** (asked,
   none → real gap) from **absence of evidence** (not captured → widen the band, don't penalize).
   Imputations are **flagged as assumed** and surfaced to the recruiter. Confidence propagates so the
   match result is a **band, not a false-precise point**.
5. **Semantic bridge.** Compare the **normalized competency profile** to the role in embedding space +
   LLM judgment — *not* raw-CV-text vs raw-JD-text keyword overlap, which is exactly what fails.

> **Techniques, named for the panel:** shared-vocabulary normalization, hierarchical/partial skill
> matching, provenance-weighted evidence, potential modeling, JD requirement-relaxation, semantic
> (embedding) matching over text matching, confidence propagation / uncertainty bands, and
> imputation-with-flags.

### 6.3 Matching & scoring  **[D10]**

**KO filter — re-mapped, not removed.** Keep location, languages, work auth, **availability** (a
student free in July is KO'd from "start immediately"), and *true* hard prerequisites (a legally
required degree, a clearance). **Replace** the "min years / seniority floor" gate with
**`isEntryEligible == true`** from the entry-lens.

**Scoring — a distinct `early_career` weight profile:**

| Dimension | BAU | Student |
|---|---|---|
| Skills / foundation | skills match | taxonomy-hierarchy-aware, **provenance-discounted** foundation match |
| Career *or* **Potential** | career fit (history ↔ role) | **potential / learning trajectory** (the replacement) |
| Education & domain relevance | minor | **major** — degree program ↔ role domain |
| Personal / motivation fit | summary ↔ culture | aspirations ↔ role; eagerness; project initiative |
| Practical readiness | (implicit in experience) | shipped artifacts? internships? hackathons? |

Total is tagged **`scoringProfile = early_career`** and carries a **confidence band**. Student scores
are **never silently ranked against senior scores** (see §6.4).

**Reasoning — different arguments are relevant.**
- *Experienced:* "10y Python, led 4-eng team → senior backend; salary aligned; minor gap in Go."
- *Student:* "Strong React foundation across 3 academic projects incl. a **deployed** thesis app;
  no production experience but ships; **fast learner** (self-taught Next.js in a semester); good
  domain fit (studies AI, role is ML). **Gap:** professional teamwork — probe in interview.
  **Recommend:** junior / graduate track." The reasoning emphasizes **potential, evidence quality,
  trajectory, and specific learnable gaps**, and is **honest about uncertainty**.

### 6.4 Outputs & UX for the recruiter  **[D11]**

A student appears **clearly differentiated and fairly assessable**:
- **Archetype badge** (STUDENT-GRADUATE) + **availability date**.
- **Match score with its confidence band** (not a fake single number) and a **potential/readiness
  score** shown alongside the skills match.
- **Evidence with provenance labels** — so a recruiter never mistakes a school project for a job.
- **Strengths · learnable gaps** (framed as "trainable", not "missing → reject").
- **Interview probes** to validate self-declared & project skills.
- **Assumptions / imputations surfaced** so the recruiter can weigh the uncertainty.
- **Fair-comparison lens** — students are shown in a separate **early-career pipeline** or a
  within-band normalized view; never mixed into one number against seniors.

> The recruiter's real need: **see that a low experience number is structural, not a red flag**, and
> get the evidence + probes to judge potential. Transparency about provenance and assumptions is what
> makes that fair.

### 6.5 Risks & trade-offs (student) → consolidated in §11.

---

## 7. Bonus — career-switchers  **[D12]**

Detected by the router as **substantial experience in domain A + intent to move to domain B**.
We **split the profile**: target-domain (B) skills are treated like a **student** (foundation,
projects, courses), while prior-domain (A) experience remains **genuine professional maturity**.

The new piece is a **transferable-skill mapper**: map domain-A competencies to domain-B equivalents
(teacher → mentoring, structured communication, "curriculum = product thinking"; analyst → data
rigor, SQL, requirements), **credit meta-skills at professional level** (communication, ownership,
delivery, domain expertise), and credit target-domain hard skills at **foundation level**
(provenance-discounted). Seniority becomes **"junior in B, but a mature professional"**; the proven
ability to learn & deliver in a prior career **boosts potential**. Reasoning leads with the
**bridge narrative** ("why domain-A strengths de-risk the switch, what must be learned, realistic
ramp time"). It reuses the student machinery but keeps professional credit for meta-skills — the key
difference from a true beginner. (`scoringProfile = career_switcher`.)

---

## 8. Data model & contract changes

The Pydantic models in `pipeline/jobfit/models.py` are the **single source of truth**; the Zod schema
`app/_lib/schemas.generated.ts` is generated from them (`npm run schemas:gen`). v2 changes must land
there first so the TS UI and Python pipeline can't drift.

**Additive model changes (high level):**
- `CandidateProfile`: add `archetype`, `archetypeConfidence`, `potentialScore`, `learningSignals`,
  `aspirations`, `completeness`. Make BAU fields (`yearsExperience`, `seniority`) **optional**.
- New `Evidence` / `SkillClaim` with `provenance` + `confidence` (+ optional `link`).
- New `Job` / `JobRequirement` (`kind`, `hardness`) / `JobEntryProfile`.
- New `Match` (per-dimension scores, `confidenceLow/High`, `scoringProfile`) + `Reasoning`
  (`trajectoryNarrative`, `assumptions`, `interviewProbes`).
- `taxonomy.json` schema v3: add `parents`/`children` edges and a `provenance` concept.

**Store changes (`app/_lib/db.ts`):** new tables `candidates`, `profiles`, `evidence`, `jobs`,
`job_requirements`, `job_entry_profiles`, `matches`, `reasoning`; re-key `gemini_cache` →
reasoning cache on `(candidateId, jobId, promptVersion)`. Keep v1 `analyses`/`jds` tables during
migration so the existing History/Library views keep working.

**API surface:** add `/api/jobs/ingest`, `/api/profile` (build+confirm), `/api/match`
(candidate→many); keep `/api/analyze*` as the legacy single-pair path until the matching UI replaces it.

**Bump `PROMPT_VERSION`** (`app/_lib/cache.ts`) on every prompt/schema/taxonomy change so stale
cached results drop out.

---

## 9. Phased roadmap (multi-session)

Each phase is independently shippable and leaves the app working. **★ = directly demoable for the interview.**

| Phase | Goal | Key work (files) | Exit criteria |
|---|---|---|---|
| **0 — Plan & diagrams** *(this session)* | Shared blueprint | `docs/V2_PLAN.md`, `docs/diagrams/*.puml` | Plan + 12 diagrams committed |
| **1 — Taxonomy graph** | Hierarchy + provenance | `data/taxonomy.json` (v3), `pipeline/jobfit/taxonomy.py` (edge traversal, partial-match), unit tests | k8s→Kubernetes still works; SwiftUI matches Swift partially; provenance plumbed |
| **2 — Job ingestion + synthetic corpus ★** | Structured jobs at scale | new `pipeline/jobfit/jobs.py` (requirement + entry-lens extraction), `data/seed_jobs/*`, `/api/jobs/ingest`, store tables | ~300 seeded jobs ingested with requirements + `JobEntryProfile`; visible in UI |
| **3 — Matching engine (BAU) ★** | candidate → many jobs | `pipeline/jobfit/matching.py` (KO + scorer), reasoning top-N + cache re-key, `/api/match`, ranked-results UI | An experienced CV produces a ranked, reasoned shortlist over the corpus |
| **4 — Archetype router + student intake ★** | Detect + collect | router in pipeline, guided intake UI (`AnalyzeTab` → profile builder), `/api/profile`, model changes (§8) | Student is detected (with override) and builds a complete profile |
| **5 — Student transformation + scoring ★** | The bridge | evidence normalizer, potential model, `early_career` weight profile + reasoning lens, confidence bands | A student CV matches entry-eligible jobs with provenance + banded scores + student reasoning |
| **6 — Recruiter UX ★** | Fair presentation | archetype badges, provenance chips, potential + confidence display, fair-comparison lens, assumptions panel | Recruiter view clearly differentiates and fairly ranks students |
| **7 — Career-switcher (bonus)** | Transferable skills | transferable-skill mapper, `career_switcher` profile + reasoning | A switcher CV gets a bridge-narrative match |
| **8 — Eval & fairness + polish** | Trust the numbers | student/switcher eval fixtures, fairness checks (§10), presentation mode | Eval thresholds defined & passing; demo script ready |

> Suggested **minimum impressive demo** if time is tight: phases **2 → 3 → 4 → 5 → 6** (skip 7).
> That alone tells the full story: a real matching platform that a student can enter and be matched
> fairly. Phase 1 underpins quality; phase 7 is the bonus; phase 8 is credibility.

---

## 10. Evaluation & fairness

- **Reuse the eval harness** (`pipeline/jobfit/eval/`). It already has `junior_frontend` and
  `career_switcher` fixtures — extend with a **student golden set**: pure-student CVs (no job history,
  thesis-only, hackathon-heavy, off-field part-time, Czech-language student) with hand-labeled
  expected archetype, entry-eligible job matches, and expected provenance.
- **New metrics:** archetype-classification accuracy, **entry-eligibility precision/recall** on jobs,
  potential-score monotonicity (a richer-evidence student should not score lower than an identical
  thinner one), and **calibration of the confidence band** (does the true outcome fall in the band?).
- **Fairness probes (explicit, because students are vulnerable to bias):**
  - **Pedigree neutrality** — swapping a prestigious university for a lesser-known one should move the
    score far less than swapping the *demonstrated skills*; we weight evidence over names.
  - **Socioeconomic** — don't let "unpaid internship / many side projects" become a hidden gate;
    surface it as one signal among several, never a KO.
  - **Language/diacritics** — Czech-language and diacritic-noisy CVs must not be systematically
    under-scored (v1 already invests here; keep the regression tests).
- **Telemetry** to monitor in production: archetype distribution, share of jobs entry-eligible,
  student match-rate vs experienced, recruiter advance-rate by archetype (drift = bias signal).

---

## 11. Risks, trade-offs & open decisions

**Top risks & mitigations**
1. **Self-declared data gaming / LLM over-crediting fluffy project text.** → Provenance + confidence;
   prefer verifiable links; adversarial "must-prove" reasoning; discount unverifiable claims.
2. **Two scoring systems → comparability confusion.** → Hard rule: label `scoringProfile`, never mix
   into one number; default recruiter view is the fair-comparison lens.
3. **Fairness/bias** (pedigree, socioeconomic, language). → §10 probes + telemetry; evidence over pedigree.
4. **Cost/latency** of per-JD entry-lens + per-pair reasoning across thousands of jobs. → Precompute &
   cache the entry-lens once per job; reasoning only on the top-N; KO filter first.
5. **Cold-start uncertainty** (thin profile → wide band). → Completeness-driven intake to shrink the
   band; show the band honestly rather than guessing a point.
6. **Archetype mis-routing.** → Confidence + user override + recruiter visibility; borderline cases can
   be scored under two profiles.

**Trade-offs we are consciously making**
- **Recall over precision for students** — surface potential (wider funnel) and let interview probes
  filter, rather than KO-ing thin profiles early. Cost: more candidates for the recruiter to review.
- **Transparency over a single clean number** — bands + assumptions + provenance are more cognitive
  load, but they are the price of fairness and trust.
- **Reuse over a bespoke student engine** — one 3-layer skeleton configured per archetype is simpler
  to maintain but constrains how radically student scoring can diverge.
- **Guided intake over zero-friction upload** — more work for the student up front, but it's the only
  way to collect the signals a thin CV omits.

**Open decisions (to confirm as we build)**
- Embedding provider/index for the demo (local vs hosted) — affects the semantic-bridge phase.
- Whether the student "potential" sub-scores are LLM-judged, deterministic, or hybrid.
- How aggressively to auto-mark a JD entry-eligible vs require a human/heuristic confirmation.
- Migration vs greenfield for the store (keep v1 tables alongside vs cut over).

---

## 12. Presentation narrative (30-min walkthrough)

A suggested arc that maps the brief's questions to live screens + diagrams:

1. **Frame the gap** (2 min) — v1 is deep-on-one-pair; the brief needs match-at-scale, and it breaks
   for students. *(show §2 table)*
2. **The platform** (5 min) — job ingestion [D05] + 3-layer matching [D06] on the seeded corpus; run
   an experienced CV → ranked, reasoned shortlist. *(live)*
3. **Why students break it** (3 min) — §3; show an experienced-axis score collapsing on a student CV.
4. **The bridge** (10 min, the core) — archetype router [D07] → guided intake [D08] → transformation
   [D09]: normalization+provenance, potential model, JD reframing, uncertainty bands. *(live student run)*
5. **Fair output** (5 min) — recruiter view [D11]: badge, provenance, potential, confidence band,
   probes, fair-comparison lens.
6. **Bonus + risks** (5 min) — career-switcher [D12]; then §11 risks/trade-offs and §10 fairness — the
   "what could go wrong and how I'd watch for it" that senior interviewers look for.

> The thesis to land: **the student problem is a representation problem.** Collect the right signals,
> translate both sides into one vocabulary, score on potential with honest uncertainty, and present
> provenance transparently — and a single 3-layer engine serves experienced, student, and switcher
> candidates alike.
