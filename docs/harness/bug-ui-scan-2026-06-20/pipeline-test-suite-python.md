# Pipeline Test Suite (Python) — Bug Hunter scan

> Context: The pytest/unittest suite that quality-gates the Python engine: matching, profiling, taxonomy contracts, fairness, devcase, LLM layer, salary/score sanity, and prompt-version sync.
> Files reviewed: 24 of 65
> Total: 6 findings — Critical: 0, High: 2, Medium: 3, Low: 1

The suite is, overall, unusually disciplined: deterministic factories (`_helpers.mkjob`/`mk_candidate`), no live network/subprocess (all `subprocess.run`/`shutil.which`/`time.sleep` are mocked), real fakes that record prompts (`_CaptureProvider`), and explicit "not green-theater" comments that show the authors already hunted for vacuous tests (`matching_eval._probe_pedigree`, `test_devcase_eval.TestOverRelianceInvariant`, `test_ats.test_old_tautology_wiring_would_hide_the_gap`). The findings below are the residual gaps where a test *claims* to verify a behavior it does not actually assert, where a tripwire is too loose to catch a silently-skipping critical test, or where a real flake exists.

## 1. Winnability "demote a must-have raises qualified pool" test asserts a tautology

- **Severity**: High
- **Category**: success-theater / tautological-assertion
- **File**: `pipeline/jobfit/tests/test_winnability.py:52` (subject under test: `pipeline/jobfit/winnability.py:87-96`)
- **Scenario**: In `test_demoting_an_unmet_must_have_raises_the_qualified_count`, four candidates have python/django/postgres/aws but not kafka; the job adds a kafka `must_have` that caps the qualified pool. The test's central claim — demoting kafka *raises* the qualified count — is asserted as `self.assertGreaterEqual(kafka["qualifiedDelta"], out["qualified"] and 0)`.
- **Root cause**: `out["qualified"] and 0` is a Python short-circuit expression that evaluates to `0` whenever `out["qualified"]` is truthy (≥1) and to the falsy `out["qualified"]` (i.e. `0`) when it is 0. The right-hand side is therefore **always `0`**. The assertion only ever checks `qualifiedDelta >= 0` — a non-negativity check, not the intended "demoting lifts the qualified pool" invariant. `qualifiedDelta` (`winnability.py:92` = `len(qual_v) - len(base_qual)`) could regress to exactly 0 (the lever does nothing) and the test would still pass.
- **Impact**: The headline value proposition of the winnability coach — "a must-have nobody has is silently capping the field; demoting it lifts the qualified pool" — is not actually regression-protected. A refactor that breaks the demote-counterfactual (e.g. computes `qual_v` against the wrong variant, or off-by-one in the delta) ships green. The very next line correctly checks `looseMustHaves[0]["skill"] == "kafka"` (ranking), so the *ranking* is covered but the *magnitude/direction* of the delta is not.
- **Fix sketch**: Replace with a concrete expectation: `self.assertGreater(kafka["qualifiedDelta"], 0)` (demoting kafka must add at least one qualified candidate). Grep the suite for the `X and 0` / `X or N` short-circuit anti-pattern in any other `assert*` right-hand side — this idiom is a silent assertion-killer.

## 2. Skip tripwire baseline tolerates the two highest-value real-credential tests never running

- **Severity**: High
- **Category**: silent-failure / coverage-gap
- **File**: `pipeline/jobfit/tests/run_gated.py:25,45-51` (skipped tests: `test_claude_cli.py:185-195`, `test_pdf_parsing_quality.py:55-62`, `test_pdf_parsing_quality.py:31,49`)
- **Scenario**: CI runs `run_gated.main()`, which fails only when `len(result.skipped) > SKIP_BASELINE` (default 4). The two tests that exercise the *real* external dependencies — the live Claude CLI smoke (`LiveSmokeTest`, gated on `KP_CLAUDE_CLI_LIVE=1`) and the Gemini PDF structured-extraction test (gated on a Gemini key) — are *always* skipped in keyless CI and are baked into that baseline of 4.
- **Root cause**: The tripwire is a count-based diff against a baseline, not an allow-list of *which* skips are expected. As long as the total skip count stays ≤4, a brand-new test that starts skipping (because someone fat-fingered a `skipUnless` env var, deleted a fixture, or an import began raising at collection) can silently replace one of the always-skipped tests and stay under the threshold — exactly the "critical test disappears into a green run" failure the wrapper's own docstring warns about.
- **Impact**: The end-to-end paths that touch money and the core extraction quality (real Gemini parsing, real Claude CLI) have **zero** enforced execution anywhere in CI, and the guard that is supposed to notice a *different* test silently skipping can be satisfied by churn within the baseline budget. Quality erosion in the LLM seam is invisible until production.
- **Fix sketch**: Make the tripwire identity-aware: maintain a set of *expected* skipped test ids and fail if the actual skipped set differs (new skip OR a previously-skipped test that started running unexpectedly), instead of comparing only counts. Separately, add a scheduled CI job that provides the keys and runs the two live tests so the external seam is exercised on a cadence.

## 3. Pedigree fairness probe keeps a structurally-unfailable secondary delta check

- **Severity**: Medium
- **Category**: success-theater (partial)
- **File**: `pipeline/jobfit/eval/matching_eval.py:186-212` (gated by `test_fairness.py:35-38`)
- **Scenario**: `_probe_pedigree` asserts `passed = (not leaked) and delta <= 3`, where `delta` is the top-score difference between a candidate whose `education_detail` names a prestige university and one naming a community college.
- **Root cause**: `build_match_candidate` deterministically *drops* `education_detail` before matching (the probe's own docstring says so), so the two candidates produce identical match inputs and `delta` is **always 0**. The `delta <= 3` clause can therefore never fail. The authors already caught and documented this ("that delta was ALWAYS 0 and the probe passed even if a regression leaked pedigree… green theater") and added the real check — `leaked = sentinel in repr(build_match_candidate(...))` — but then *retained* the delta clause as a "secondary, now-meaningful check." It is not meaningful: because the field never reaches scoring, the delta cannot move even if a leak were introduced elsewhere, so it adds false assurance to the probe's pass detail.
- **Impact**: Low real risk (the `leaked` check is sound and is what actually gates), but the probe's reported detail string ("top-score delta {delta} (<=3)") implies an accuracy guarantee the test does not provide. If someone later removes the `not leaked` clause believing the delta clause still protects them, the probe becomes vacuous again.
- **Fix sketch**: Either drop the delta clause entirely (the leak check is the invariant), or make it bite by scoring against the *raw* profile that still carries `education_detail` through a path that does not drop it — proving that even when the name is present in the source, the score is unaffected. Annotate clearly that the leak check is primary.

## 4. `test_present_year_reads_system_clock` is flaky across the New-Year boundary

- **Severity**: Medium
- **Category**: flaky / clock-dependent
- **File**: `pipeline/jobfit/tests/test_profiling.py:19-21`
- **Scenario**: `test_present_year_reads_system_clock` asserts `present_year() == date.today().year`. If `present_year()` reads the clock at 23:59:59.999 on Dec 31 and the test's own `date.today()` evaluates after midnight (or vice-versa), the two year values differ and the test fails spuriously — once a year, non-reproducibly.
- **Root cause**: Two independent live-clock reads compared for equality. The rest of the file is exemplary (every other test pins `as_of=` explicitly), so this is the only unpinned read, and it exists solely to prove the default path is clock-sourced.
- **Impact**: A rare, confidence-eroding red CI run on a date boundary with no underlying defect — the kind of flake that trains people to re-run CI blindly. Negligible blast radius but a genuine non-determinism in a suite that is otherwise fully deterministic.
- **Fix sketch**: Patch the clock: `with mock.patch("pipeline.jobfit.profiling.date") as d: d.today.return_value = date(2026, 6, 1); self.assertEqual(present_year(), 2026)`. This proves the same property (anchor follows the clock) without two racing reads.

## 5. Fairness/matching gate is computed once in `setUpClass` over a single shared report

- **Severity**: Medium
- **Category**: shared-mutable-state / weak-isolation
- **File**: `pipeline/jobfit/tests/test_fairness.py:14-42` (and `test_devcase_eval.py:57-60`, `test_automation.py` uses module-level `BAU`/`STUDENT`)
- **Scenario**: `MatchingEvalTest.setUpClass` calls `run()` once and stores the result on the class; all five test methods read `self.report`. `Report.scenarios`/`probes` are mutable lists holding mutable dataclasses, and `run()` mutates the passed-in profiles in place (`matching_eval._eval_scenario` does `profile.archetype = detected`). The module-level `SCENARIOS` profile objects are reused across the process.
- **Root cause**: A class-scoped fixture that shares a single computed report and reuses module-global mutable scenario profiles. As written today no test mutates the report, so it passes — but the pattern is fragile: any future test that mutates a `ScenarioResult`/`Probe` (or re-invokes `run()` with the same `SCENARIOS`, whose profiles `_eval_scenario` already overwrote `archetype` on) introduces order-dependence. The `THRESHOLDS["role_relevance_at5"] = 0.60` bar (`thresholds.py:26`) is also quite permissive — only 60% of top-5 need to be in-family — so a real relevance regression that drops one of four scenarios from 100% to 75% still clears.
- **Impact**: Latent order-dependence and a low relevance floor mean the fairness gate is less load-bearing than it appears. Today's green is correct; a small future change could make it silently order-dependent (the worst kind of flake to debug).
- **Fix sketch**: Build the report fresh per test (or `copy.deepcopy(SCENARIOS)` inside `run()` so `_eval_scenario`'s in-place `profile.archetype =` write cannot leak across calls). Separately, reconsider whether `role_relevance_at5 = 0.60` is tight enough to catch a one-scenario relevance regression, given only four scenarios feed the aggregate.

## 6. Several `assertIsNotNone` checks are thin where the return value's content matters

- **Severity**: Low
- **Category**: weak-assertion
- **File**: `pipeline/jobfit/tests/test_insights.py:12`, `test_recruiter_cli.py:108`, `test_live_case.py:120`
- **Scenario**: A handful of tests assert only that a result is "not None" where the meaningful contract is the result's shape/values. Most occurrences in the suite are correctly paired with follow-up assertions (e.g. `test_live_case.py:56-61` checks `.kind`, `.provenance`, `.skills`, `.confidence` right after the `assertIsNotNone`; `test_ats.py:65-72` checks `.matched` and coverage %). The thin ones are `test_insights.py:12` (asserts a context object exists but not its fields) and `test_recruiter_cli.py:108` (asserts a fairness block is present without asserting its contents).
- **Root cause**: Existence checks substituted for content checks on objects whose *content* is the behavior under test — a presence assertion passes even if the object is an empty/degenerate shell.
- **Impact**: Low — these guard genuinely-present return values, so they catch the "returned None / crashed" regression, just not the "returned a structurally-empty result" one. They are the weakest links in an otherwise strongly-asserted suite.
- **Fix sketch**: For each thin `assertIsNotNone`, add one assertion on the field that encodes the behavior the test name promises (e.g. assert the insights context names the candidate/role it summarizes; assert the recruiter fairness block has the expected keys/non-empty cohorts). Keep the existence check as a precondition.
