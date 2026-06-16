> Moonshots: 5 (Tier1/2/3: 3/2/0)

# Candidate Intelligence — Moonshots

**Cluster question**: *how accurately and defensibly do we understand a candidate, from CV + GitHub + interview signal.*

## What genuinely exists today (grounding read)

The engine is already unusually principled about candidate understanding, which is exactly why the moonshots have to aim past "more signal":

- **A provenance-weighted evidence model.** `pipeline/jobfit/profile.py` (`CandidateProfileV2`, `Evidence.resolved_provenance`, `SkillClaim`) plus `taxonomy.PROVENANCE_WEIGHTS` (observed=1.0 … self_declared=0.4) means every skill carries *how we know it*. `pipeline/jobfit/transform.py` unions claims+evidence by strongest provenance into a `MatchCandidate`.
- **Layered, fairness-aware scoring.** `pipeline/jobfit/matching.py`: KO gates → multi-factor scorer → bounded **dynamic weights** (`resolve_weights`/`weight_bounds`) → a **`fairness_matrix`** that scores every candidate under *every other candidate's* weight scheme so a single weighted scalar from different yardsticks is never trusted. `_confidence` returns an honest band + the reasons it is wide.
- **A hypothesis-not-verdict stance.** `soft_signals.py` emits antipatterns/hidden-strengths each carrying `source`, `confidence`, `needs_confirmation`, `suggested_probe`, and a `probe_kind` that routes a CV hypothesis to a devcase covert probe (`panel_to_probe_briefs`). `pipeline.py` folds deterministic `authenticity.py` findings into a trust ledger (`sanity_checks` → `app/_lib/sanity-checks.ts` trust band).
- **The highest-trust signal is behavioral.** `live_case.py` mints `observed`-provenance evidence ONLY when a candidate clears a competence bar on a real work sample / case-grounded interview, and even corroborates the archetype routing.
- **GitHub is deliberately signal-not-source.** `github-analysis/route.ts` + `github-evidence.ts` review README/commit-subjects/file-NAMES only, with `describeEvidenceBasis()` honesty and `confirmed_skills` vs `unverified_claims`.

**The structural gap the moonshots attack:** every one of these is a *single candidate, single snapshot, self-asserted* read. There is **no ground truth, no calibration, no memory across candidates or time, and no portable artifact** of what was verified. The system is confident but never *checked against reality*. That is the category-defining opening.

---

## 1. **The Calibration Engine — turn every score into a probability with a measured Brier score**
- **Tier**: 1 (10x category-defining)
- **Category**: foundational-primitive
- **Impact**: Recruiters and (more importantly) buyers cannot tell a *good* AI recruiter from a *confident* one. Today the engine emits a 0-100 fit total and an *assumed* honest band (`matching._confidence` adds spread from heuristics — "early-career", "<3 skills"), but **nobody has ever measured whether a 72 means 72% likely to pass the next stage.** The 10x change: every score becomes a *calibrated probability of a downstream outcome* (advance / hire / clear-the-work-sample), and the platform publishes its own **Brier/calibration curve** the way a weather forecaster does. This converts "trust us" into "here is our measured track record" — the single most defensible thing a hiring AI can own, and the precondition for outcome-based pricing.
- **Feasibility**: medium — the outcome labels and the predictions both already exist in the DB; the missing piece is joining them and fitting a calibration map.
- **Time-horizon**: months
- **Why it's a moonshot**: It reframes the product from "an opinion generator" to "a measured instrument." No ATS or AI-screener exposes its own calibration; doing so is audacious because it makes the product *falsifiable* — and that honesty is the moat. It also unlocks legally defensible adverse-impact math (calibration-by-subgroup) that incumbents can't produce.
- **Path to implementation**:
  1. **STEP 1 (in scaffold)**: In `app/_lib/db/analyses.ts` the row already carries `score` and a recruiter `disposition` (advance/hold/pass via `setAnalysisDisposition`). Add a read-only `calibrationPairs()` query that joins saved `score` to the eventual disposition/pipeline outcome for that candidate_label — the first (prediction, outcome) dataset, computed entirely from existing columns.
  2. Define the prediction contract: have `score_job`/`_score_from_payload` emit a probability head alongside the points total (start with the existing `confidence` band as the prior).
  3. Fit an isotonic/Platt calibration map per role-family in a new `pipeline/jobfit/eval/calibration.py` (sits beside `matching_eval.py`/`thresholds.py`, which already own the golden-set harness).
  4. Surface the calibration curve + Brier score in `app/features/sub_analytics` as a first-class "How accurate are we?" panel.
  5. Recompute weekly via the tasks queue; gate score display behind "calibrated since N outcomes" so a cold start reads honestly.
- **Dependencies**: a trickle of real outcomes (disposition + pipeline transitions already logged); per-role bucketing.
- **Risks**: thin outcome volume on a demo corpus (mitigate with the eval golden set as synthetic ground truth + clear "uncalibrated" labeling); recruiters gaming dispositions.
- **What changes if we ship it**: the product can say, with evidence, "a 70 from us advances 70% of the time" — and price against it. Candidate understanding stops being a vibe and becomes an instrument with a published error bar.

## 2. **The Longitudinal Candidate Graph — one durable, provenance-versioned identity that compounds across every touch**
- **Tier**: 1 (10x category-defining)
- **Category**: data-as-moat
- **Impact**: Today a candidate is re-understood from scratch on every CV upload (`analyze_cv` builds a fresh `CandidateProfileV2`), and the only persistence is per-analysis rows keyed by `candidate_label` (a *string*). The 10x change: a **stable candidate entity** whose evidence accretes over time — CV v1 → GitHub review → live-case `observed` skills → interview scorecard → outcome — each as a *provenance-and-time-stamped* fact, never overwritten. Re-understanding becomes *updating beliefs*, not restarting. This is the asset that gets better the more the platform is used and is impossible for a new entrant to clone: a verified, longitudinal evidence ledger per person.
- **Feasibility**: medium — the evidence/provenance primitives already exist (`Evidence`, `resolved_provenance`, `live_case.apply_*` already *append* observed evidence to a profile); what's missing is identity + persistence + time.
- **Time-horizon**: quarters
- **Why it's a moonshot**: It turns a stateless analyzer into a system of record for *demonstrated capability over time* — the recruiting equivalent of a credit bureau. It also makes every other moonshot here (calibration, drift detection, the credential) dramatically stronger because they finally have a subject to attach to.
- **Path to implementation**:
  1. **STEP 1 (in scaffold)**: Add a `candidates` identity table + `candidate_id` foreign key in `app/_lib/db/analyses.ts`/`db/core.ts` (which already owns schema init), resolving on a normalized key (email/GitHub login from `parseGithubUsername`) with `candidate_label` as the fallback display — backfilled from existing rows.
  2. Persist `Evidence` items (not just the rolled-up analysis blob) into an append-only `candidate_evidence` table, carrying `provenance`, `confidence`, `recency`, and `observed_at`.
  3. On a new analysis, *merge* into the existing profile instead of replacing — `transform.build_match_candidate` already consolidates by strongest provenance; run it over the union.
  4. Add an evidence-recency decay so a 3-year-old self-declared skill is weighted below a fresh observed one.
  5. Expose a per-candidate timeline (the `candidate-timeline.ts` pattern already exists for pipeline entries) showing belief change over time.
- **Dependencies**: stable identity resolution; a migration (note `migration.runOnce` lacks a transaction per the backlog — fix first).
- **Risks**: identity collisions / GDPR right-to-be-forgotten on an append-only ledger (design deletion in from day one); merge conflicts across contradictory CVs.
- **What changes if we ship it**: the platform's understanding of a person *compounds*. A returning candidate is recognized; a re-application updates rather than re-litigates; the data moat deepens with every interaction.

## 3. **Adversarial Proof-of-Skill — generate a per-candidate "verification trap" that AI-padded CVs cannot survive**
- **Tier**: 1 (10x category-defining)
- **Category**: assessment-redefined
- **Impact**: The #1 emerging crisis in hiring is that CVs (and increasingly GitHub repos and take-home answers) are LLM-generated, and `authenticity.py` is honest that it is only a *deterministic screen* ("verify in interview"). The 10x change: close the loop by **auto-generating a candidate-specific micro-challenge that directly probes their thinnest/most-overclaimed signal** — the `soft_signals` panel already produces exactly this targeting (`overclaim_risk` → `probe_kind="verification_trap"`, `panel_to_probe_briefs`), but the brief is never *materialized into a live, adversarial artifact*. Generate a 10-minute interactive probe (extend/debug real code using the over-claimed skill; explain a design under a curveball) that a CV-padder fails and a real practitioner passes, scored against an expected-reasoning rubric.
- **Feasibility**: medium — the targeting, the probe-kind taxonomy, the devcase `design_case(focus_probes=…)` hook, the `llm_judge`, and `live_case.observed_evidence` (mint observed skill on pass) ALL exist. The missing piece is the lightweight, *covert*, sub-interview probe format.
- **Time-horizon**: months
- **Why it's a moonshot**: It inverts the AI-cheating arms race — instead of *detecting* fabrication (a losing game), it *makes fabrication useless* by demanding live demonstration tuned to each candidate's specific overclaim. That is a genuinely new assessment primitive, not a better filter.
- **Path to implementation**:
  1. **STEP 1 (in scaffold)**: Wire `soft_signals.panel_to_probe_briefs(panel)` (already built, returns `{kind, focus, rationale}`) into the analysis result so the recruiter UI surfaces "3 verification probes auto-targeted at this candidate's overclaims" — today `build_soft_signal_panel` runs in `pipeline.py` but the briefs are never threaded to a surface.
  2. Add a `verification_trap` micro-case generator beside `devcase/design.py` that takes a single `focus` skill and emits a 10-min interactive snippet + an expected-reasoning rubric.
  3. Score it with the existing `devcase/llm_judge.py`; on pass, mint `observed` evidence via `live_case.apply_live_case` (already the contract).
  4. Feed pass/fail back into the authenticity band and (moonshot #2) the candidate graph.
  5. A/B the trap vs. CV-only screening against outcomes (moonshot #1's harness).
- **Dependencies**: devcase engine (exists); a candidate-facing interactive runner (the apply-token + SeedFiles pattern exists).
- **Risks**: candidate friction / drop-off (keep it short, frame as "show, don't tell"); rubric quality; accessibility.
- **What changes if we ship it**: "AI-written CV" stops being a threat the platform apologizes for in a `limitations` array and becomes a non-issue — the score reflects what the candidate *demonstrated*, individually targeted at what they were least able to prove on paper.

## 4. **Drift & Disagreement Sentinel — the engine that knows when its own understanding is unreliable**
- **Tier**: 2 (3-5x)
- **Category**: trust-layer
- **Impact**: The engine has many *independent* readers of the same candidate — the deterministic pre-pass (`_build_deterministic_evidence`), the Gemini extraction, the regex `build_profile` fallback, the GitHub `confirmed_skills`, the soft-signal detectors — but it never asks **do they agree?** The 3-5x change: a sentinel that measures *cross-source disagreement* per candidate (e.g. CV claims "senior Kubernetes" but GitHub signals + live-case show none) and *model drift* over time (does `gemini-3-flash-preview` score the golden set the same this week as last?). Disagreement becomes a first-class, surfaced uncertainty signal that widens the confidence band and routes to human review.
- **Feasibility**: high — every source already produces structured output; this is a comparison layer, not new extraction.
- **Time-horizon**: weeks
- **Why it's a moonshot**: It is the difference between a model that is occasionally wrong silently and one that *raises its hand* when its inputs contradict each other — operational trustworthiness most AI products lack entirely. It is also the cheapest of the five and directly de-risks the others.
- **Path to implementation**:
  1. **STEP 1 (in scaffold)**: In `pipeline/jobfit/pipeline.py`, the `AnalysisMetadata.deterministic_evidence` (detected_skills/seniority) and the LLM `profile.skills`/`current_seniority` are *both already computed and both on the result*. Add a `_disagreement_checks(evidence, profile)` that emits warn-shaped `sanity_checks` lines when the deterministic and LLM reads conflict (e.g. seniority off by ≥2 ranks) — reusing the existing trust-ledger plumbing (`sanity-checks.ts` already classifies warns and stamps `review_flags`).
  2. Add GitHub vs CV skill-claim disagreement (`confirmed_skills` vs `skill_claims`) as a second sentinel at the API layer.
  3. Pipe golden-set re-scores through `eval/runner.py` on a schedule; alert when this week's vector diverges from the recorded baseline in `eval/thresholds.py` (model drift).
  4. Make disagreement a `_confidence` driver in `matching.py` so a contradicted candidate gets a wider, explained band.
- **Dependencies**: none new — all inputs exist.
- **Risks**: noisy disagreements desensitize recruiters (rank by severity, cap surfaced count); false drift alarms on model upgrades (version-pin baselines).
- **What changes if we ship it**: the engine stops being uniformly confident. A contradicted candidate visibly reads "our sources disagree — verify," and a model regression is caught by the platform before it reaches a single hiring decision.

## 5. **The Portable Verified-Skill Passport — a signed, candidate-owned credential of what was *observed*, not claimed**
- **Tier**: 2 (3-5x)
- **Category**: new-market
- **Impact**: Everything the engine learns dies inside one recruiter's SQLite. The `observed`-provenance evidence minted by `live_case.py` is the *only* trustworthy capability data most candidates will ever have produced — and it is locked away. The 3-5x change: let a candidate **export a signed, verifiable credential** ("demonstrated *working* Kubernetes on a live case, transfer 78/100, verified 2026-06") they can carry to other employers and platforms. This bootstraps a **two-sided network**: candidates bring their passport (reducing re-screening cost), employers trust it because it is signed + provenance-stamped + tied to a real work sample, and the platform becomes the issuing authority.
- **Feasibility**: medium — the verified-evidence data and provenance model exist; the new work is identity, signing, and a verification endpoint.
- **Time-horizon**: quarters
- **Why it's a moonshot**: It moves the company from *a tool one recruiter buys* to *the standard credential candidates and employers transact on* — a platform/ecosystem play with classic network effects. Owning the verified-skill credential layer is a far larger market than CV screening.
- **Path to implementation**:
  1. **STEP 1 (in scaffold)**: The public-token + signed-link pattern already exists (`app/schedule/[token]`, `app/offer/[token]`, `safe-url.ts`, `public-base-url.ts`). Add a read-only `app/passport/[token]/page.tsx` that renders the `observed`-provenance `Evidence` items for one candidate (filter `Evidence.provenance === "observed"`) as a public, shareable verification page — purely from data that exists.
  2. Add HMAC/asymmetric signing of the passport payload (mirror `billing/webhook-verify.ts`'s verification discipline) and a `/api/passport/verify` endpoint a third party can call.
  3. Define the credential schema (skill, level, provenance, transfer_score, issued_at, issuer) via codegen so TS/Python share it.
  4. Build candidate-side export (the apply/devcase candidate surfaces already exist) and an employer-side "import a passport" that seeds `observed` evidence into a new analysis (skips re-screening).
  5. Tie issuance to the candidate graph (#2) so a passport reflects the *latest* verified belief.
- **Dependencies**: candidate identity (#2); signing keys; candidate consent/ownership UX.
- **Risks**: credential forgery (signing mitigates); employer trust cold-start (seed with the issuing recruiter's own roles); privacy/consent (candidate-owned, opt-in export by design).
- **What changes if we ship it**: verified capability becomes *portable*. The platform stops being a silo and becomes the issuer of a credential that follows the candidate — the wedge into a far larger, two-sided market than single-recruiter screening.

---

### Why these go beyond the existing ~141 backlog ideas
The backlog already covers embedding search, GitHub deep-read, ghost-profile/authenticity bands, the provenance dossier, dynamic JD matching, and the outcome-feedback loop. Those all sharpen a *single, snapshot, self-asserted* read of one candidate. These five instead add the three things the engine structurally lacks: **ground truth it is measured against** (#1, #4), **memory that compounds across people and time** (#2, #5), and **demonstration that defeats fabrication rather than detecting it** (#3). Each STEP 1 rides primitives that already exist in the read files — provenance evidence, the soft-signal probe briefs, the `observed` live-case bridge, the disposition column, and the public-token signing pattern — so the audacious end-states each begin with something doable this week.
