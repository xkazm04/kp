> Total: 6 findings (0c critical, 1h high, 2m medium, 3l low)

## 1. `seed_jobs.py` generic spec-grid path is superseded by `seed_jobs_csas.py` and produces nothing committed
- **Severity**: High
- **Category**: dead-code
- **File**: pipeline/jobfit/seed_jobs.py:36-38 (`FAMILIES`, `LOCATIONS`, `COMPANY_TYPES`), :40-43 (`_SYSTEM`), :46-71 (`build_specs`), :74-104 (`spec_to_prompt`), :338-339 (`main`)
- **Scenario**: The committed corpus is the ČS one — `head data/seed_jobs/jobs.normalized.json` shows every record `"company": "Česká spořitelna"`, and that normalized file is what the app DB seeds (`app/_lib/db/core.ts:981`) and the matching/eval harness loads (`matching.py:789 _DEFAULT_CORPUS`, `matching_eval.py:408`). The generic generator's distinctive constants (`COMPANY_TYPES` = enterprise/scaleup/startup/…, the 7-city `LOCATIONS`) are referenced ONLY inside `seed_jobs.build_specs`/`spec_to_prompt` (`grep -rn "COMPANY_TYPES\|LOCATIONS"` → only seed_jobs.py self-refs), and `seed_jobs.main` is wired into nothing — `grep` of package.json/scripts/CI for a non-csas `seed_jobs` invocation finds only stale docs/scan-report references, never a runnable target. So `seed_jobs.main` + its generic grid produce a corpus the product no longer ships. NOTE: the MODULE is not dead — `seed_jobs_csas.py:24` imports `run_seed_main` and `seed_jobs_csas.build_specs`/`spec_to_prompt` shadow the generic pair; `generate`/`write_normalized`/`summarize`/`run_seed_main` are the live shared core.
- **Root cause**: The codebase pivoted to a single real target customer (ČS). The CSAS variant reuses the shared runner via `prompt_fn`/`specs` hooks but the original generic spec grid + `main` were left behind rather than removed.
- **Impact**: A reader can't tell which generator is canonical; running the documented `python -m pipeline.jobfit.seed_jobs --count 150` would silently overwrite the ČS corpus with generic synthetic jobs (no ČS company, wrong locations), breaking the demo and the matching_eval empty-corpus guidance that explicitly tells you to regenerate with `seed_jobs_csas`.
- **Fix sketch**: Keep the shared core (`run_seed_main`, `generate`, `write_normalized`, `summarize`, `_gen_one`, `_stamp`, `DEFAULT_OUT`). Delete the now-unused generic `build_specs`, `spec_to_prompt`, `_SYSTEM`, `FAMILIES`, `LOCATIONS`, `COMPANY_TYPES`, and `main` (drop the `if __name__` block), OR repoint `seed_jobs.main` to call `seed_jobs_csas.main` with a clear "generic corpus retired" note. Confirm no test imports the generic pair first (none do today).

## 2. Per-fixture scoring is copy-pasted between `runner._run_fixture` and `seed_cv_fixtures._score`
- **Severity**: Medium
- **Category**: duplication
- **File**: pipeline/jobfit/eval/seed_cv_fixtures.py:224-265 (`_score`), duplicating pipeline/jobfit/eval/runner.py:220-271 (the scoring half of `_run_fixture`)
- **Scenario**: `seed_cv_fixtures._score` rebuilds a `FixtureResult` field-for-field from a payload: same `candidate`/`salary` extraction, same `_salary_band`, same string→list coercion of `expected_role_family`/`expected_seniority`, same `_range_overlap(_safe_int(rng[0]), _safe_int(rng[1]))`, same `_skill_recall`, same education-match branch, same `actual={roleFamily,seniority,salary,skills,education}` dict. It already imports `_range_overlap`, `_safe_int`, `_salary_band`, `_skill_recall` from runner (seed_cv_fixtures.py:43-52), so only the *assembly* is forked. The two have already drifted slightly: runner also computes `signals_recall`, `_score` hard-codes `signals_recall=None`.
- **Root cause**: `runner._run_fixture` couples "call `analyze()`" with "score the payload" in one try-block, so the seed script couldn't reuse just the scoring half and reimplemented it.
- **Impact**: Any change to the scoring contract (a new axis, a tolerance tweak, a salary-coverage rule) must be made in two places or the golden harness and the ČS pilot silently diverge — exactly the drift the centralized `_style`/`thresholds` modules were created to prevent.
- **Fix sketch**: Extract a pure `score_payload(name, expected, payload, duration_s) -> FixtureResult` in runner.py (the body after `analyze()` in `_run_fixture`), have `_run_fixture` call it, and replace `seed_cv_fixtures._score` with an import of it. Behavior-preserving; covered by `test_eval_runner.py`.

## 3. Unused `STAGES` constant in seed_pipeline (the live driver is `FUNNEL`)
- **Severity**: Medium
- **Category**: dead-code
- **File**: pipeline/jobfit/seed_pipeline.py:29
- **Scenario**: `STAGES = ("Accepted","Screened","Interview","Offer","Hired")` is defined but never read — `grep -rn "\bSTAGES\b" pipeline/jobfit` returns only the definition line. Stage assignment is driven entirely by `FUNNEL` (seed_pipeline.py:32-37, used at `:106 FUNNEL[i % len(FUNNEL)]`). `STAGES` is a stale leftover from before the funnel-weighted spread replaced a flat stage list.
- **Root cause**: The funnel model was introduced (`FUNNEL` + the "Consolidated model" comment at :31) but the original flat `STAGES` tuple was left in place.
- **Impact**: Misleading — a maintainer may think `STAGES` is the canonical stage vocabulary and edit it expecting an effect, or keep the two in sync needlessly. The real vocabulary now also lives in `app/_lib/approval-kinds.ts`.
- **Fix sketch**: Delete line 29. If a canonical stage tuple is wanted for validation, derive it as `tuple(dict.fromkeys(FUNNEL))` instead of a hand-maintained parallel list.

## 4. Dead `_STAMPED` constant in seed_jobs
- **Severity**: Low
- **Category**: dead-code
- **File**: pipeline/jobfit/seed_jobs.py:107-108
- **Scenario**: `_STAMPED = ("role_family","seniority","work_mode","location","languages")` with the comment "Dimensions we control for distribution" is never referenced — `grep -rn "_STAMPED"` (excluding worktrees) returns only the definition. The actual stamping is done field-by-field in `_stamp` (seed_jobs.py:111-120), which does not iterate `_STAMPED`.
- **Root cause**: Looks like an intended data-driven loop in `_stamp` that was instead written as explicit assignments; the constant was orphaned.
- **Impact**: Dead documentation-shaped constant; trivial confusion and a maintenance trap (editing `_STAMPED` does nothing).
- **Fix sketch**: Delete lines 107-108, or refactor `_stamp` to loop over `_STAMPED` (`for k in _STAMPED: record[k] = spec[...]`) so the constant earns its keep. Deletion is the lower-risk choice.

## 5. Dead `_ANSI` re-export in runner.py (back-compat with no remaining consumer)
- **Severity**: Low
- **Category**: dead-code
- **File**: pipeline/jobfit/eval/runner.py:43
- **Scenario**: `from ._style import _ANSI, _make_styler, should_color  # noqa: F401  (_ANSI re-exported for back-compat)`. The `_ANSI` palette is consumed only inside `_style.py` itself (`_style.py:16,22`). No module or test imports `_ANSI` from `runner` — `matching_eval.py:40` and `automation_eval.py:40` import only `GLYPH_NA, glyph, verdict_banner`; `seed_cv_fixtures.py:43-52` imports scoring helpers; `test_eval_runner.py:16-23` imports `GLYPH_NA, FixtureResult, Report, _fixture_passed, _salary_band, _salary_cell`. The "back-compat" the noqa preserves has no caller.
- **Root cause**: `_ANSI` was once re-exported through runner; consumers were migrated to `_style`/glyph helpers but the re-export (and its noqa) stayed.
- **Impact**: A confusing `# noqa: F401` that signals an external contract that doesn't exist; minor lint noise.
- **Fix sketch**: Drop `_ANSI` from the import → `from ._style import _make_styler, should_color` and remove the noqa comment. Run `python -m pipeline.jobfit.tests.test_eval_runner` + `test:eval` to confirm.

## 6. `LADDER` carries `staff`/`principal` rungs the seed pipeline can never produce or price
- **Severity**: Low
- **Category**: dead-code
- **File**: pipeline/jobfit/eval/seed_cv_fixtures.py:62
- **Scenario**: `LADDER = ["junior","medior","senior","lead","staff","principal"]`, but `seniority_base` (seed_cv_fixtures.py:100-120) only ever returns up to `"lead"` (max branch `return "lead"`), and `staff`/`principal` have no salary band — `grep '"staff"\|"principal"' data/salary_benchmarks.json` returns nothing, so `_band_span` (`role_band(family, s)` at :136) silently drops them. The two trailing rungs only affect `expected_seniority_set`'s ±1 window at the very top, which `seniority_base` can never reach. Effectively unreachable tail entries.
- **Root cause**: The ladder was authored optimistically with a full IC progression; the seniority deriver and the benchmark data top out at `lead`.
- **Impact**: Harmless but misleading — implies the harness scores staff/principal candidates when no seed path or salary band exists for them; a future `_band_span` call on those rungs returns the `(40000, 250000)` fallback.
- **Fix sketch**: Trim `LADDER` to `["junior","medior","senior","lead"]` to match `seniority_base` and the benchmark families, OR add staff/principal bands to `salary_benchmarks.json` if those levels are intended. Trimming is the lower-risk fix; verify `LADDER.index`/window math in `expected_seniority_set` still holds (it does for a shorter list).
