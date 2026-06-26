# Matching & Transformation Engine — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀4 / 🚀1 | Severity: C0/H3/M2/L0

Context note: this engine is unusually well-documented — nearly every constant carries
recorded reasoning inline, and most "computed-but-unsurfaced" outputs (winnability,
fairness matrix, confidence drivers, KO reasons, matched-skill strength, adverse-impact)
are already wired into the app. The findings below are the genuine remaining gaps: a
captured signal the scorer ignores, the one undocumented coefficient cluster, an
unenforced fairness contract, and two self-flagged/undocumented scoring constants.

## 1. Skill recency is captured end-to-end but never enters any score
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / competitive differentiation
- **File**: pipeline/jobfit/profile.py:83 (also transform.py:159, taxonomy.py:527)
- **Observation**: `Evidence.recency` is a first-class field — Gemini is prompted to extract it (gemini.py:66), the pipeline populates it (pipeline.py:568), and live-case/interview minting stamps `recency="now"` (live_case.py:137,273). Yet its ONLY consumer is `sorted(... key=lambda e: e.recency ...)` for ordering CV highlights (transform.py:159). `skill_match_score` (taxonomy.py:527) and every scorer take `provenance` but never recency, so a "professional" skill last used 10 years ago scores byte-identically to one used last quarter.
- **Why it matters**: Recency is a first-order signal every serious matching product weights — "the heart of the product's hiring decisions" currently treats a decade-stale skill as fully current, a silent wrong signal in both directions (over-credits stale CVs, under-differentiates current ones). The data is already collected, so this is value sitting one coefficient away from being realized — and a concrete differentiation claim ("we weight skill freshness, not just possession") that competitors can't make from kp's own captured data.
- **Recommendation**: Add a bounded recency decay multiplier (alongside `provenance_weight`) in `skill_match_score`, e.g. parse `recency` to a months-ago and apply a gentle floored decay; surface "last used" on matched skills. Keep it bounded (never below, say, 0.7) so it nuances rather than dominates, mirroring the provenance cap pattern.
- **Effort**: M

## 2. The early-career readiness model rests on ~12 undocumented coefficients
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: unexplained constants / highest-stakes
- **File**: pipeline/jobfit/transform.py:102 (and :43, :53, :58, :80)
- **Observation**: `compute_potential` replaces years-of-experience for an ENTIRE archetype family (students + switchers) and its output rides the `career` slot verbatim (matching.py:597). Unlike the rest of the engine — which documents almost every constant — this function's numbers are bare: `depth=len/3.0` then `+0.15*shipped`; `velocity=n_skills/8.0`; `foundation={phd:1.0,master:0.85,bachelor:0.7,university:0.5}`; `initiative` increments `0.4/0.3/0.3/0.2`; and the final blend `0.35*depth + 0.25*velocity + 0.25*foundation + 0.15*initiative` (line 102). None carries recorded reasoning or a calibration source.
- **Why it matters**: This is the single highest-stakes cluster of unexplained constants in the engine. `velocity = n_skills/8.0` (line 53) means a candidate who lists 8 skills maxes the velocity term regardless of depth or provenance — a keyword-stuffing incentive at the core of how every early-career hire is ranked. With no recorded rationale, no one can defend, audit, or safely re-tune these numbers (a live concern given kp's own EU-AI-Act/adverse-impact tooling expects explainable scoring).
- **Why it matters / Recommendation**: Add a short rationale block (as taxonomy.py/registry.py already do) for each weight and saturation denominator, name the calibration basis (even "designer judgment, pending data"), and reconsider `velocity` keying off distinct-skill COUNT vs provenance-weighted depth so breadth-spam can't max a dimension.
- **Effort**: M

## 3. The early-career "fair, separate pipeline" guarantee is asserted but unenforced (UI-delegated)
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: unenforced contract / fairness
- **File**: pipeline/jobfit/recruiter.py:73 (docstring lines 5-7)
- **Observation**: `rank_candidates_for_job`'s docstring promises early-career candidates are "shown as its own pipeline, never silently ranked on one number against experienced candidates." But the function calls `score_job` for every candidate regardless of archetype and returns ONE flat list sorted by `(koPassed, total)` (line 74). The actual fairness behavior lives entirely in a comment — "the UI splits by archetype for fair comparison" (line 73) — i.e. the core fairness promise is delegated to whatever consumer renders the rows.
- **Why it matters**: A senior (BAU `career` = work-history fit) and a student (`career` = potential) produce one `total` on the same 0-100 scale and get sorted together here. Any consumer that renders the list flat — a CSV export, a new screen, an API client — silently does exactly what the docstring says must never happen, mixing archetypes on a single incomparable number. A guarantee that depends on tribal knowledge ("remember to split in the UI") is one refactor away from a fairness regression in the product's most legally-sensitive surface.
- **Recommendation**: Make the engine carry the contract: attach a `track`/`archetypeGroup` field per row and either return rows pre-grouped or expose a helper that yields per-track ranked lists, so cross-track ranking is structurally impossible rather than a UI convention.
- **Effort**: S

## 4. `score_personal` overlap saturation `/5.0` is ad-independent and self-flagged as coarse
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic number / deferred trade-off
- **File**: pipeline/jobfit/matching.py:379 (note at :376-378)
- **Observation**: The keyword-overlap term is `min(1.0, hits / 5.0)` — 5+ overlapping skills = full credit — and the code itself flags it: "the /5.0 saturation constant ... is a known coarse heuristic ... left as-is here ... tracked as a separate tuning item (denominator tied to the ad's keyword surface)." The denominator is a fixed 5 regardless of how many skills the ad actually names.
- **Why it matters**: `personal` is a full scoring dimension (weighted per archetype). A focused JD listing 3 skills can never push a candidate past 0.6 on overlap no matter how perfect the match, while a keyword-stuffed ad listing 12 saturates easily — so the dimension's ceiling is set by ad verbosity, not candidate fit. It's an acknowledged distortion sitting in production at the heart of scoring.
- **Recommendation**: Tie the denominator to the ad's own keyword surface (e.g. `min(len(distinct ad skill tokens), K)`), or at minimum convert the inline NOTE into a tracked issue with the sanity-suite pins listed, so the deferral is visible outside this one comment.
- **Effort**: S

## 5. `score_career` cross-family penalty 0.35 and seniority `/3.0` are the only undocumented score_* constants
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: unexplained transferability coefficient
- **File**: pipeline/jobfit/matching.py:310-315
- **Observation**: `score_career` returns `0.6 * family + 0.4 * max(0, seniority_proximity)` where `family = 1.0 if same role_family else 0.35` and `seniority_proximity = 1.0 - abs(rank_diff)/3.0`. Every other scorer in this file documents its weights; this one (the BAU `career` dimension for all experienced hires) has none — the `0.35` cross-family transferability coefficient and the `/3.0` seniority span are bare.
- **Why it matters**: `0.35` is precisely a "transferability coefficient" — the prompt's flagged highest-stakes constant type. It decides how much a strong senior in an adjacent role family (e.g. backend → data) is discounted on career fit across the entire experienced-candidate pool, yet carries no recorded reasoning, making it un-auditable and risky to tune. The contrast with the meticulously-documented `score_motivation` (0.4/0.35/0.25, line 413) makes the omission stand out.
- **Recommendation**: Document the rationale and basis for `0.35` and the `/3.0` span (or source them from the same registry that holds archetype weights), so the cross-family discount is explainable alongside the rest of the scoring contract.
- **Effort**: S
