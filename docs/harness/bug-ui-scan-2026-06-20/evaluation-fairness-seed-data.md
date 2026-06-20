# Evaluation, Fairness & Seed Data — Bug Hunter scan

> Context: Offline eval harness (thresholds, matching/automation eval, fixtures) and the deterministic seed datasets (jobs, candidates, pipeline, analyses, salary benchmarks).
> Files reviewed: 16 of 19
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. `_probe_pedigree` masks a real prestige-scoring leak behind a delta<=3 tolerance

- **Severity**: High
- **Category**: fairness-metric-correctness
- **File**: `pipeline/jobfit/eval/matching_eval.py:186-212`
- **Scenario**: A regression makes `build_match_candidate` keep `education_detail`, OR matching starts crediting an evidence/skill token that correlates with university prestige. The probe's primary invariant (`sentinel not in repr(candidate)`) still passes if the leak is anything *other* than the literal sentinel string (e.g. the matcher derives a numeric prestige boost, or the name reaches scoring via a different field name). The secondary guard, `delta <= 3`, then silently absorbs a genuine pedigree advantage of up to 3 score points.
- **Root cause**: The probe asserts a *structural* invariant (one specific token absent from one repr) plus a *loose numeric* one. A 3-point pedigree swing is presented as PASS — but 3 points is enough to reorder a top-5 and is exactly the kind of bias the probe claims to forbid. The threshold is a magic number with no justification tying it to score resolution.
- **Impact**: The fairness panel can show "pedigree excluded ✓" while a prestige signal is in fact moving candidates by several points — green theater of the precise kind the docstring warns against.
- **Fix sketch**: Require `delta == 0` for the structural-exclusion claim (the field is dropped, so the only honest delta is exactly 0). If any non-zero delta appears, fail loudly — a non-zero delta means *something* about the name changed the score, which is the bug. Also assert exclusion against the *built candidate's full field set*, not a single sentinel substring.

## 2. `Report.aggregate()` defaults `entry_precision` to 1.0 when no scenario is early-career

- **Severity**: High
- **Category**: silent-failure / edge-case
- **File**: `pipeline/jobfit/eval/matching_eval.py:260-261` (and `passes()` at 269-272)
- **Scenario**: If the `SCENARIOS` list is ever edited to contain only non-early-career scenarios (e.g. someone trims it to the `senior_backend` case while debugging, or a future refactor builds scenarios dynamically and the early-career ones drop out), `entry_vals` is empty and `entry = ... if entry_vals else 1.0`. The entry-precision gate (threshold 0.99) then passes vacuously at 1.0 with zero scenarios actually exercising the KO-remap guarantee.
- **Root cause**: The in-scenario fix (scoring `0.0` on an empty match list) protects against *empty matches*, but the *aggregate* still treats "no early-career scenarios measured" as a perfect score rather than "not measured". A coverage gap is folded into an accuracy pass.
- **Impact**: The eval can report `entry_precision 100% PASS` while never having tested the entry-eligibility invariant at all — the exact "all-None defaults to 1.0 PASS" failure the code comment at line 162-164 says it is guarding against, re-introduced one level up.
- **Fix sketch**: When `entry_vals` is empty, either exclude `entry_precision` from `passes()` (don't gate on an unmeasured axis) or fail the run with an explicit "no early-career scenarios — entry precision unmeasured" message. Never substitute `1.0` for "not measured".

## 3. `seed_pipeline` stage assignment is biased by candidate sort order, not merit

- **Severity**: Medium
- **Category**: seed-data-fairness / latent-bias
- **File**: `pipeline/jobfit/seed_pipeline.py:106-129`
- **Scenario**: `stage = FUNNEL[i % len(FUNNEL)]` where `i` is the candidate's index in `candidates.json` (sorted by `id`, i.e. `cand-000`, `cand-001`, …). The approval flags (`i % 6`, `i % 9`) and the near-match tiebreak (`near[i % len(near)]`) are likewise driven by the same positional index. Because `build_specs` assigns archetype/family by a seeded RNG keyed to that same index, a candidate's pipeline stage, "needs decision" flag, and matched req correlate with their `id` ordinal rather than their actual match score.
- **Root cause**: Positional index is overloaded as both a deterministic spreader and a stand-in for ranking. The funnel position a candidate lands in is independent of `result.total`, so a weak candidate can sit at `Offer`/`Hired` while a strong one sits at `Accepted`.
- **Impact**: Demos and any analytics computed over the seed (conversion rates, stage-by-archetype fairness dashboards, calibration panels that read the seeded pipeline) reflect an artifact of `id` ordering, not the matching engine. Fairness metrics derived from this seed are measuring the seed generator, not the model.
- **Fix sketch**: Drive funnel placement from a function of `result.total` (e.g. score-banded stages with a little deterministic jitter) so the seeded funnel is at least monotonic in match quality, and document that stages are illustrative.

## 4. `_band_span` falls back to a 40k–250k catch-all that auto-passes the salary axis

- **Severity**: Medium
- **Category**: eval-correctness / masked-failure
- **File**: `pipeline/jobfit/eval/seed_cv_fixtures.py:131-137`
- **Scenario**: For any candidate whose `family` has no band in `salary_benchmarks.json` (any of the 13 non-tech families, or a family typo), `role_band` returns `None` for every seniority, `bands` is empty, and `_band_span` returns the hardcoded `(40000, 250000)`. That 210k-wide expected range will overlap essentially any plausible Gemini salary, so `_range_overlap` returns a high score and the salary axis passes regardless of what the model emitted.
- **Root cause**: A "safe" fallback range chosen to avoid crashing also happens to be wide enough to be unfalsifiable. A missing benchmark silently degrades the salary gate from "is the band right?" to "did the model emit any number in a 6x-wide window?".
- **Impact**: Seeded-fixture salary scores for non-tech families are meaningless-but-green. A salary-extraction regression for those families would never trip the gate.
- **Fix sketch**: When no band is found, mark the fixture's salary axis as not-applicable (like `salary_present=None` semantics) and exclude it from the aggregate, rather than inventing a permissive range that always passes.

## 5. `align_candidates_csas` overwrites real skill claims with a deterministic random subset, decoupling CVs from evidence

- **Severity**: Medium
- **Category**: seed-data-integrity
- **File**: `pipeline/jobfit/align_candidates_csas.py:75-93, 107-140`
- **Scenario**: `_aligned_skill_claims` does `rng.sample(track["skills"], n)` and *replaces* `record["skillClaims"]` wholesale; separately, each evidence item's `skills` is re-pointed to a rolling window of the track stack (lines 120-124). The candidate's narrative evidence text (`ev["text"]`, titles, prior-job descriptions) is preserved from the original generic generation, but the demonstrated skills attached to it are now synthetic and may not appear anywhere in the prose.
- **Root cause**: Alignment mutates the structured skill layer without touching the free-text layer, so the two drift. A career-switcher's "taught mathematics for 9 years" evidence can end up tagged with `["Swift", "SwiftUI"]`.
- **Impact**: When `seed_cv_fixtures` renders these to natural-language CVs (or when authenticity/provenance checks run), the evidence text and the claimed skills are inconsistent — undermining the realism the seed exists to provide and potentially confusing any provenance/authenticity eval downstream.
- **Fix sketch**: After re-pointing evidence skills, regenerate or at least sanity-check that each claimed skill has *some* textual support; or re-render the evidence text from the aligned skills so prose and structure agree.

## 6. `automation_eval` protected-term regex over- and under-flags across languages

- **Severity**: Medium
- **Category**: fairness-check-correctness
- **File**: `pipeline/jobfit/eval/automation_eval.py:44-48, 138-146`
- **Scenario**: `_check_rejection` flags a "FAIRNESS" failure if `_PROTECTED_RE` matches the rejection blob. The word-boundary list is a fixed English+partial-Czech set. (a) Under-flag: a German-language rejection (the seed supports `["Czech","English","German"]` candidates) mentioning `Alter`/`Geschlecht` passes clean. (b) Over-flag: a legitimate, fair rejection that says "we value a diverse, **religious**-holiday-friendly culture" or names a candidate "**Marital**" surname / the word "**rasa**" in an unrelated Czech compound trips a false fairness failure, since `RELIABILITY_THRESHOLD` is 1.0 — one false hit fails the entire gate.
- **Root cause**: A regex denylist is treated as a hard, 100%-required fairness invariant across multiple languages it doesn't fully cover, with no allowance for context. Precision and recall are both imperfect, but the gate is binary and absolute.
- **Impact**: False positives can wedge CI on a perfectly fair output; false negatives certify a discriminatory rejection as fair for unsupported languages. Both erode trust in the reliability gate.
- **Fix sketch**: Scope the regex to the candidate's actual `languages`, expand the German set if German candidates are in scope, and treat a hit as a flag for review rather than an automatic reliability-zero unless the term appears in an accusatory construction.

## 7. `load_corpus()` inside `matching_eval.run()` is unguarded against a missing/corrupt corpus

- **Severity**: Low
- **Category**: error-handling / unhappy-path
- **File**: `pipeline/jobfit/eval/matching_eval.py:275-277` (vs the guarded `main()` at 395-401); `pipeline/jobfit/matching.py:786-790`
- **Scenario**: `main()` carefully wraps `load_corpus(_DEFAULT_CORPUS)` in `try/except (FileNotFoundError, json.JSONDecodeError)` and prints a helpful empty-corpus message. But `run(jobs=None)` — the public entry point used by tests and `test_eval_runner`-style callers — calls bare `load_corpus()` with no guard. A deleted or truncated `jobs.normalized.json` raises an uncaught exception straight out of the library function (which itself does no guarding).
- **Root cause**: The empty/corrupt-corpus resilience lives only in the CLI `main`, not in the reusable `run`. The two entry points have divergent robustness.
- **Impact**: Any programmatic caller of `run()` gets an unhandled traceback instead of the friendly "regenerate with seed_jobs_csas" guidance, and an *empty* (but valid) corpus file would sail past `run()` into all-zero scenarios with no early signal.
- **Fix sketch**: Move the empty/corrupt-corpus handling into `run()` (or into `load_corpus`, returning a clear error), so both `run()` and `main()` degrade identically; have `run()` raise a typed `EmptyCorpusError` callers can catch.
