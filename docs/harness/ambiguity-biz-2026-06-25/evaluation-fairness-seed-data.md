# Evaluation, Fairness & Seed Data — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C0/H2/M3/L0

## 1. The offline fairness eval is a "dark capability" — never published as a trust/compliance artifact
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark-capability / trust asset
- **File**: pipeline/jobfit/eval/matching_eval.py:355 (probes defined :186-248; docstring :12-19)
- **Observation**: `matching_eval.py` runs four explicit, deterministic fairness probes — `pedigree_field_excluded` (university name structurally dropped before matching), `socioeconomic_inclusion` (no internship is not a KO), `language_neutrality` (Czech/diacritic skills resolve like English), `potential_monotonicity` — and the code itself calls them "the brief's centrepiece (Rizika a trade-offy)" and "the hero of the report." Yet the output is markdown/JSON to stdout only: `grep` across `app/`+`src/` for `matching_eval`/`potential_monotonicity`/`language_neutrality` returns **zero** hits. The product surfaces a *runtime* per-shortlist `FairnessPanel` (recruiter.fairness_check), but NOT the offline eval that proves the engine is fair *by construction*.
- **Why it matters**: The flagship seed customer is a regulated bank (Česká spořitelna / Erste Group); algorithmic hiring is EU-AI-Act high-risk. A versioned, passing "How we keep matching fair" report — pedigree provably excluded, no socioeconomic KO, language-neutral — is a top-tier sales/compliance differentiator that competitors rarely have. Today it's computed every run and thrown away.
- **Recommendation**: Emit `matching_eval --json` into a committed, dated artifact and render it as a public/enterprise "Fairness methodology & results" trust page (and a downloadable PDF for procurement). Near-zero new logic — surface what already runs.
- **Effort**: M

## 2. Eval pass/fail thresholds are magic numbers with no recorded calibration rationale
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: magic constants / gate provenance
- **File**: pipeline/jobfit/eval/thresholds.py:14-31
- **Observation**: The file is the "single source of truth" for every gate and even validates each value is in range — but never records *why each number*. Why is `role_family` gated at 0.85 while `seniority` only 0.70? Why `role_relevance_at5` 0.60 (barely above chance) but `archetype_accuracy` a perfect 1.0 and `entry_precision` 0.99? Why `QUALITY_THRESHOLD = 3.5` on a 1–5 judge? The docstring carefully explains *why salary is split into two axes* yet says nothing about the cut points themselves. Notably `data/salary_benchmarks.json:5` proves the team *can* document provenance richly — these gates simply don't.
- **Why it matters**: These thresholds decide whether the pipeline is allowed to ship. If the numbers are arbitrary, a green "PASS" certifies nothing and a future tightening/loosening is unarguable. Tribal knowledge that belongs in writing.
- **Recommendation**: Add a one-line rationale per threshold (target, who set it, calibration source/date) inline or in a short `docs/MATCHING_EVAL.md`, mirroring the `salary_benchmarks.json` `_doc` convention.
- **Effort**: S

## 3. The curated salary-benchmark dataset is a sellable artifact left unsurfaced
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: monetization / value-on-the-table
- **File**: data/salary_benchmarks.json:5-119
- **Observation**: This is a sourced (Platy.cz, Kitalent, Glassdoor/Levels.fyi), 16-family × 4-seniority CZK band table for the 2026 Czech market — a genuinely valuable, hand-curated comp dataset. It is used purely internally to anchor the Gemini prompt; nothing exposes it to candidates or recruiters.
- **Why it matters**: "What does this role pay in Prague?" is exactly the question candidates and hiring managers pay benchmarking vendors for. A free "Czech tech salary explorer" is a proven lead magnet / SEO funnel, and a per-seat "market evidence" report is an upsell. The asset exists; the product surface doesn't.
- **Recommendation**: Ship a read-only salary-bands explorer (family × seniority, with the cited sources) as a candidate-facing lead magnet, and reuse it in the recruiter "market evidence" tab. Add an `as_of`/version field so it can be marketed as "2026 data."
- **Effort**: M

## 4. Golden fixtures carry no provenance for their expected salary/skill values — silent drift risk
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: golden-dataset provenance
- **File**: pipeline/jobfit/eval/fixtures/senior_python_ai.json:1 (schema gate: runner.py:277)
- **Observation**: Each committed fixture has a human `label` but no field recording *where* `expected_salary_range` (e.g. 110000–220000) or `expected_skills_subset` came from — hand-authored, derived from `salary_benchmarks.json`, or a real offer? `_REQUIRED_FIXTURE_KEYS` (runner.py:277) enforces presence but not provenance. When the benchmark bands shift (the JSON's `_doc` already flags upcoming multi-currency work, P0-2), nothing ties fixtures to the source they should track.
- **Why it matters**: A golden set whose intent/derivation is undocumented either masks a real regression (expected range was stale-but-generous) or fires a false failure (benchmarks moved, fixtures didn't) — and no reviewer can adjudicate which without re-deriving by hand.
- **Recommendation**: Add an optional `provenance`/`source` note per fixture (and a "derived from salary_benchmarks vYYYY" tag where applicable); document the golden-set's curation intent in the same doc as finding #2.
- **Effort**: S

## 5. Seed-fixture expectations apply generous, undocumented tolerances that quietly weaken the PASS gate
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: happy-path tolerance / unexplained constants
- **File**: pipeline/jobfit/eval/seed_cv_fixtures.py:146 (also `_band_span` fallback :131-137)
- **Observation**: `expectations()` hardcodes `career_switcher → ["junior","medior","senior"]` as all-acceptable seniorities (line 146), on top of an already ±1-notch tolerance for everyone (`expected_seniority_set`), and a salary band spanning *every* accepted seniority (`_band_span`). The fallback band is a very wide `(40000, 250000)` (line 137). The rationale for accepting "senior" for a switcher — or how wide is too wide — is asserted in passing, not justified.
- **Why it matters**: `seed_cv_fixtures` prints a "passes golden thresholds ✓" badge and persists analyses as if validated. With this much built-in slack, a switcher mis-scored two rungs high, or a salary off by 100k CZK, can still register PASS — the badge reads as quality assurance while certifying very little. Recruiters trusting that signal would be misled.
- **Recommendation**: Record the intended tolerance budget (why ±1 notch, why switchers span 3 rungs, what the band-width cap should be) in the eval doc, and tighten or annotate the `(40000, 250000)` fallback so an empty band can't trivially pass.
- **Effort**: S
