# Dev Case Pipeline (Python) — bug-hunter + ui-perfectionist scan

> Context: The Python engine behind dev cases — analyze a need, design a case, evaluate submissions, reflect, run lifecycle audits, judge with an LLM, and (new) calibrate case generation on a real cross-industry JD corpus.
> Files reviewed: 10 of 22
> Total: 5

## 1. `calibrate` silently overwrites the frozen canonical corpus (`jobs.json`)

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption / data-loss
- **File**: `pipeline/jobfit/devcase/calibrate.py:284` + `pipeline/jobfit/devcase/real_corpus.py:280-287`
- **Scenario**: An operator runs the full calibration and blesses it — `calibrate --count 100 --judge --freeze` — writing `data/seed_calibration/jobs.json` (the 100-JD corpus the docstring says "Part 2 also consumes") plus `FROZEN.json`. Later they run a quick pilot to re-check one thing: `calibrate --count 12`. `main` calls `build_corpus(12, ...)`, which **unconditionally** `JOBS_PATH.write_text(...)` — truncating the canonical corpus to 12 jobs. `FROZEN.json` now describes a 100-job run that no longer exists on disk, and Part 2 (candidate simulation / eval-prompt hardening) silently runs on the shrunken set.
- **Root cause**: `build_corpus` conflates "derive a stratified sample" with "persist THE canonical corpus," and `--count` drives both the run size and the persisted file size. `calibrate` imports `load_jobs` (line 48) — the intended "reuse the frozen corpus" path — but **never calls it**; the docstring comment "build it if missing … else reuse" (line 283) describes behavior the code does not implement.
- **Impact**: One pilot run destroys an expensive (~hundreds of CLI calls), hand-frozen fixture with no prompt, no backup, and no warning; the freeze provenance becomes a lie.
- **Fix sketch**: In `calibrate.main`, reuse the frozen corpus when present: `jobs = load_jobs() if JOBS_PATH.exists() and not args.no_resume else build_corpus(...)`. Make `build_corpus` write only when the file is absent or `--no-resume`, and never truncate an existing larger corpus to a smaller `--count`.

## 2. `--resume` cache is model/prompt-version blind → the gate certifies cases a *different* model generated

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / success-theater
- **File**: `pipeline/jobfit/devcase/calibrate.py:131-138` (`_process`) + `:178-197` (`_row_from_file`)
- **Scenario**: A prior run cached `cases/cal-000.json … cal-099.json` on the default model. The prompt is then hardened, or the operator pins a new model: `calibrate --count 100 --model haiku --freeze`. `_process` (resume default on) calls `_row_from_file` and returns any cached row where `source == "llm" and reliable` — **without comparing `promptVersion` or model**. So every already-cached JD is served from the OLD model/prompt; only misses run on `haiku`. The gate, `JUDGE_REPORT.md`, and `--freeze` then bless a corpus that the model/prompt under test never produced.
- **Root cause**: The cache key is the positional scenario id (`cal-NNN`) alone. `_prompt_versions` is recorded into each case file (line 148-153) but the resume check ignores it, so "is this cached case still valid for what I'm calibrating now?" is never asked. Re-calibrating a changed prompt requires a human to remember to wipe `cases/`.
- **Impact**: A calibration run reports PASS/FAIL and freezes a canonical fixture for a model/prompt that did not generate the cases — the exact "certifying something that didn't run" failure the module's `error_fallbacks` gate exists to prevent, reintroduced through the cache.
- **Fix sketch**: Invalidate a cached row when its stored `promptVersions` (and a recorded model tag) differ from the current run's; only honor the cache when both match. Add a `--model`/prompt-version stamp to the case file and compare it in `_row_from_file`.

## 3. [STILL-OPEN] Trailing prompt-injected JSON wins scoring — no `expected_keys` on any devcase call

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: trust-boundary / prompt-injection
- **File**: `pipeline/jobfit/devcase/provenance.py:164` (`provider.complete_json(prompt, system=system)`); selector at `pipeline/jobfit/claude_cli.py:324-352` (`_extract_json`)
- **Scenario**: `_extract_json` returns the **last** top-level JSON value unless `expected_keys` pins one by shape. A `grep` confirms `expected_keys` is referenced only inside `claude_cli.py` itself — **no** devcase caller (evaluate / reflect / design / analyze / seed, all routed through `generate_with_fallback`) passes it. Since the submission (commits, `DECISIONS.md`) is adversary-authored, a candidate whose text nudges the model to append a trailing `{"dimensionScores":{...100...},"concerns":[]}` gets that object taken verbatim over the genuine answer.
- **Root cause**: "last value wins" defeats few-shot echo but hands the selector to attacker-controllable trailing text; the one available mitigation (`expected_keys`) is wired through the whole stack but never used at any call site. Still present since the 2026-06-20 scan (prior finding #3).
- **Impact**: A candidate can inflate their own capability/transfer scores or suppress `overRelianceFlags`/`concerns` — the fairness-critical signals the case exists to measure.
- **Fix sketch**: Have `generate_with_fallback` accept and forward `expected_keys`; pass each step's known schema keys (`dimensionScores`, `transferScore`, `files`, …). Reject responses carrying >1 top-level object of the expected shape rather than silently picking one.

## 4. `real_corpus` reuses a truncated `_raw_rows.json` cache, silently narrowing the corpus

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / silent-failure
- **File**: `pipeline/jobfit/devcase/real_corpus.py:144-169` (`fetch_rows`)
- **Scenario**: Someone does a quick debug pull, `real_corpus --fetch-limit 100`, which caches only 100 raw rows to `RAW_CACHE`. A later full build (`--count 100`, no `--fetch-limit`, resume default) hits `if resume and RAW_CACHE.exists(): return cached if limit is None else cached[:limit]` and reuses the **100-row** cache instead of re-fetching the full dataset. Stratification then draws from a tiny, tech-skewed slice; the only signal is a `<6 families` WARNING printed to stderr (line 305-306) that a batch run discards.
- **Root cause**: The cache records rows but not the *extent* of the fetch that produced them, so a narrow prior pull satisfies a later broad request. `resume` treats "a cache exists" as "the cache is complete."
- **Impact**: The corpus that the whole calibration exists to broaden (against the bank/tech industry-lock) is silently rebuilt narrow — defeating the module's stated purpose while every report reads green.
- **Fix sketch**: Stamp the fetched-row count / whether it was full into the cache (or a sibling meta file) and re-fetch when a later request needs more than the cache holds; at minimum, ignore the cache when `fetch_limit is None` but the cache was written under a limit.

## 5. `float(x or default)` masks a legitimate zero fluency / read-before-write in deterministic scoring

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / silent-wrong-result
- **File**: `pipeline/jobfit/devcase/evaluate.py:128-129`
- **Scenario**: The deterministic evaluator computes `fluency = float(tooling.get("fluency") or 0.5)` and `rbw = float(reflection.get("readBeforeWrite") or 0.4)`. Both are genuine 0..1 ratios. A candidate whose measured `fluency` is exactly `0.0` (or `readBeforeWrite` `0.0` — "never read before generating," the worst case) hits the falsy-`or` and is scored as if the value were the neutral `0.5`/`0.4`. `tooling` then reports `_pct(0.5)=50` instead of `0`, and `framing`/`transfer` inherit the inflated inputs.
- **Root cause**: `x or default` conflates "absent" with "measured zero." This path is exactly the one that runs whenever the LLM provider is degraded/`--no-llm`, so the masked signal is not a rare corner.
- **Impact**: The single strongest negative signal (zero verification fluency / zero read-before-write) is silently upgraded to a middling score on a candidate-facing capability — the opposite of what the rubric is meant to surface.
- **Fix sketch**: Distinguish missing from zero: `v = tooling.get("fluency"); fluency = float(v) if isinstance(v, (int, float)) else 0.5` (same for `readBeforeWrite`). Apply the pattern wherever a legitimately-zero numeric is defaulted via `or`.
