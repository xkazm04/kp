# Evaluation, Fairness & Seed Data — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. `align_candidates_csas` silently re-skins every NON-TECH candidate into a Java engineer
- **Severity**: High
- **Lens**: ambiguity
- **Category**: silent-assumption-corpus-drift
- **File**: `pipeline/jobfit/align_candidates_csas.py:108`
- **Scenario**: An operator grows the candidate corpus with the newer non-tech bank slice (`python -m pipeline.jobfit.seed_candidates --nontech`, ids `cand-050..`, families `finance_accounting` / `operations_logistics` / `sales_marketing` / `customer_support`), then runs the documented ČS alignment step `python -m pipeline.jobfit.align_candidates_csas`. Every non-tech candidate comes out with a Java/Swift/Angular skill stack and `targetRole: "Java Backend Engineer"`.
- **Root cause**: `TRACKS` only defines the three tech families (lines 38–62). `align_record` falls back with `family = record.get("roleFamily") if record.get("roleFamily") in TRACKS else "software_engineering"`, so a `finance_accounting` candidate is coerced onto a `software_engineering` track — its `skillClaims`, evidence skills, aspirations, and `targetRole` are all overwritten — while `roleFamily` is left as `finance_accounting`. The module docstring predates the non-tech slice and still promises "only their demonstrated skill stack is aligned".
- **Impact**: The internally-inconsistent records (finance family + Java skills + Java targetRole) then flow into `seed_analyses` and `seed_pipeline`, so the non-tech jobs added specifically to exercise the round-4 taxonomy have no coherent candidates to match. A demo regeneration in the wrong order quietly destroys the non-tech population.
- **Fix sketch**: Either skip records whose `roleFamily` is not in `TRACKS` (leave non-tech candidates untouched), or add non-tech tracks. At minimum, make the fallback explicit — log/skip instead of silently homing on `software_engineering` — and update the docstring to state that align only handles the three tech families.

## 2. `select_pilot`'s "spanning sample" can never reach the non-tech families
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: stale-coverage-constant
- **File**: `pipeline/jobfit/eval/seed_cv_fixtures.py:63`
- **Scenario**: A reviewer runs the default golden-fixture pilot (`seed_cv_fixtures --pilot`, 8 candidates) trusting the docstring "Deterministic spanning sample: cover family × archetype combos first" to represent the corpus. No `finance_accounting` / `customer_support` / `sales_marketing` / `operations_logistics` candidate is ever scored.
- **Root cause**: `FAMILIES` (line 63) and `ARCHETYPES` (line 64) still list only the three tech families and three archetypes. `select_pilot` iterates that grid first (9 combos) and only top-ups afterward, so with the default count of 8 the loop is satisfied before any non-tech candidate is considered.
- **Impact**: The pilot that persists analyses to the app DB and writes `fixtures_csas/` silently under-represents half the seeded taxonomy; a non-tech extraction regression cannot be caught by the pilot the team actually runs.
- **Fix sketch**: Derive `FAMILIES`/`ARCHETYPES` from the loaded candidate corpus (or extend both lists to include the non-tech families), so the spanning grid covers whatever families exist. Alternatively raise the default pilot count so the family×archetype grid spans the full taxonomy.

## 3. Fairness probes assert the guarantees from a single synthetic profile
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: undocumented-scope-of-claim
- **File**: `pipeline/jobfit/eval/matching_eval.py:219`
- **Scenario**: A reader takes the module's "explicit FAIRNESS probes (the brief's Rizika a trade-offy)" header (lines 12–19) as evidence the pipeline is fair across the population. In fact `_probe_socioeconomic` (line 219) and `_probe_monotonicity` (line 242) only ever build `_student_frontend()`, and `_probe_language` (line 230) hard-codes two term pairs. The four routing scenarios (lines 118–135) are all `software_engineering`/`data_ai`.
- **Root cause**: Every probe reuses one early-career software-engineering profile; no data/product or non-tech candidate, and no seniority other than a student, is exercised. Gender — a live axis the seed data deliberately balances via feminized surnames (`seed_candidates._feminize`) — is never probed at all.
- **Impact**: Socioeconomic inclusion, language neutrality, and monotonicity are certified for exactly one archetype/family, but the green banner reads as a population-wide fairness pass. A pedigree/internship/gender bias that only manifests for, say, a senior data candidate would pass the gate.
- **Fix sketch**: Parameterize the probes over a small matrix (student + switcher + bau × 2–3 families) and add an explicit gender-neutrality probe (two profiles differing only in a gendered name/surname must score identically). If broadening is out of scope, tighten the docstring to state the probes cover the early-career SWE surface only.

## 4. Career-switcher salary band is so wide the salary axis is vacuous for them
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: gate-that-cannot-fail
- **File**: `pipeline/jobfit/eval/seed_cv_fixtures.py:145`
- **Scenario**: A career-switcher fixture is scored on `salary_overlap`. It passes essentially no matter what band Gemini emits.
- **Root cause**: For switchers `expectations()` hard-codes `sen_set = ["junior", "medior", "senior"]` (lines 145–146), then `_band_span` unions the role bands across all three seniorities — e.g. `software_engineering` becomes ≈`[42000, 154500]`. `_range_overlap` returns `1.0` whenever the emitted band is contained, and a high IoU otherwise, so almost any plausible CZK band clears the `salary_overlap` 0.60 threshold.
- **Impact**: The salary axis contributes no real signal for the career-switcher cohort while still counting toward the aggregate pass, inflating confidence that salary extraction works for the hardest-to-price group.
- **Fix sketch**: Narrow the switcher band to the two most defensible rungs (e.g. junior–medior) or score switcher salary on a looser but non-trivial tolerance, and add a one-line comment noting the axis is intentionally lenient (not vacuous) for this archetype.

## 5. Undocumented magic constants couple the golden expectations to the taxonomy
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: magic-numbers
- **File**: `pipeline/jobfit/eval/seed_cv_fixtures.py:137`
- **Scenario**: A future dev tunes the salary taxonomy bands or the seniority ladder and can't tell why some fixtures shift, because the eval's own fallback numbers are unexplained.
- **Root cause**: `_band_span` returns a bare `(40000, 250000)` fallback (line 137) with no comment on where it comes from or when it fires, and `seniority_base` buckets years at `3 / 6 / 10` (lines 116–120) with no note that these must track the taxonomy's rung boundaries. Both are silent constants embedded in ground-truth generation.
- **Impact**: The expectations that gate the whole harness carry hidden assumptions; a taxonomy change can silently invalidate the golden set with no breadcrumb.
- **Fix sketch**: Name the fallback (e.g. `_FALLBACK_BAND`) with a comment on when a family/seniority has no `role_band`, and add a one-line comment on the `3/6/10` thresholds pointing at the seniority ladder they mirror so the coupling is discoverable.
