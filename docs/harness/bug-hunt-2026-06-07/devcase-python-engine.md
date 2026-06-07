# Bug Hunt — Dev Case Python Engine

> Total: 7
> Critical: 0 | High: 3 | Medium: 3 | Low: 1

## 1. Eval harnesses report 100% reliability when every LLM call silently fails
- **Severity**: High
- **Category**: silent-failure
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/devcase/submission_eval.py:201 (and lifecycle_eval.py:113 `run_one`)
- **Scenario**: Run `python -m pipeline.jobfit.devcase.lifecycle_eval --count 100` (LLM mode) while the Claude CLI is reachable but every call raises (auth expired mid-run, model returns un-parseable text every time, provider rate-limited so each `complete_json` raises `ClaudeCliError`). The harness completes and prints `reliable: 100/100 (100%) · LLM rows: 0` — a green health report. The same happens in `submission_eval.py`.
- **Root cause**: `provenance.generate_with_fallback` catches the raised LLM exception, stashes a `fallbackReason` *inside the artifact*, and returns source `"deterministic"` (provenance.py:109-114). That `fallbackReason` is only surfaced by `devcase_cli._fallback_reasons`; the eval harnesses' `Row` (submission_eval.py:173, lifecycle_eval.py:96) never reads it. `combine_source` then collapses an all-raised run to `"deterministic"`, indistinguishable from an intentional `--no-llm` run. The well-formed deterministic templates pass every `_check`/`_check_case` validator, so `reliability` is 100% and `llm_rows` is 0.
- **Impact**: The eval suite is meant to certify the LLM path's health/fairness/discrimination. A totally broken provider (auth, parsing, quota) is reported as a healthy run with the deterministic baseline silently substituted. An operator validating a prompt change or a model bump gets a false "all green" and ships. `--strict` also passes (reliability == 100%).
- **Fix sketch**: In `run_one`, pop `FALLBACK_REASON_KEY` off each artifact and record it on the `Row` (e.g. `fallback_reasons: dict[str,str]`). In `signals()`/`_report_md`, count rows that fell back due to an *error* (distinct from `--no-llm`) and surface a top-line warning; have `--strict` treat "ran in LLM mode but N rows error-fell-back" as a non-zero exit.

## 2. Malformed LLM dimension scores silently replaced by the deterministic estimate, still tagged `source="llm"`
- **Severity**: High
- **Category**: silent-failure
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/devcase/evaluate.py:147
- **Scenario**: The LLM returns `{"dimensionScores": {"framing": 82, "tooling": "very high", "judgment": null, "architecture": 70, "transfer": 65}, ...}`. `coerce` runs `dims = {d: _score_int(raw.get(d), det["dimensionScores"][d]) for d in _DIMS}`. `_score_int("very high", default)` and `_score_int(None, default)` both fall back to the *deterministic* per-dimension estimate, so `tooling`/`judgment` quietly become the heuristic numbers while `framing`/`architecture`/`transfer` are the real LLM scores. The artifact is still returned with `source="llm"`.
- **Root cause**: `_score_int` (evaluate.py:60-64) swallows `TypeError/ValueError` and returns the supplied default. The default here is the deterministic estimate, not a neutral/missing marker, and no per-dimension provenance is recorded — so a partially-parsed evaluation is reported as a fully-LLM one.
- **Impact**: A candidate's `judgment`/`tooling` score (the fairness-critical dimensions) can be the heuristic guess rather than the model's read, with nothing in the envelope (`source`, `fallbackReason`, `confidence`) signaling it. Same pattern in `score_transfer` (`transferScore`) and `reflect`/`tooling` clamps. This produces plausible-but-wrong evaluations that look fully LLM-graded.
- **Fix sketch**: When *any* expected dimension fails to parse on the LLM path, either (a) record a per-step degradation marker (e.g. `partiallyParsed: ["tooling","judgment"]`) on the artifact so the envelope can show it, or (b) treat a malformed individual score as `MISSING_DIMENSION_SCORE` (the documented "no signal" value) rather than the deterministic estimate, so it doesn't masquerade as a measured score.

## 3. `interview_scenario` module fails to import if interview-script.json is missing/malformed
- **Severity**: Medium
- **Category**: recovery-gap
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/devcase/interview_scenario.py:29-31
- **Scenario**: The companion file `pipeline/jobfit/interview-script.json` is absent, truncated, or contains a syntax error (a partial deploy, an encoding mangle, a bad edit). Any `import` of `interview_scenario` — e.g. `devcase_cli interview-scenario` — raises `FileNotFoundError`/`json.JSONDecodeError` at module-load time, *before* the CLI's try/except (the import is inside the `if args.command == "interview-scenario":` block at devcase_cli.py:255, so it surfaces as a 500 engine_error with a raw stack-trace-ish message rather than a clean degraded path).
- **Root cause**: `_SCRIPT` is loaded eagerly at module top level with no guard, and `deterministic_scenario` (the "never fails" fallback) depends on it (`_skeleton_phases()` reads `_SCRIPT["phases"]`, line 67). So the deterministic fallback cannot save a missing/corrupt skeleton.
- **Impact**: A single bad/absent JSON asset takes out the entire interview-scenario command with an opaque error, and there is no degraded mode. Since the same file is shared with the TS brief renderer, a schema drift (e.g. renamed `listenFor` key) also raises `KeyError` inside `_skeleton_phases` for every call.
- **Fix sketch**: Wrap the load in a helper that raises a clear, actionable error (or returns a minimal hard-coded skeleton) and validate the expected phase keys once at load; in `devcase_cli`, move the import so the failure maps to a precise error code instead of a bare 500.

## 4. `claude_cli.map` only catches `ClaudeCliError`; a `ValueError` from an empty prompt sinks the whole judge sweep
- **Severity**: Medium
- **Category**: recovery-gap
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/claude_cli.py:197-206 (triggered via llm_judge.run_judge:37-38)
- **Scenario**: A judge/audit item produces an empty or whitespace-only prompt (e.g. `audit_role_fit` over a row whose `role`/`case` coerced to empty strings, so the f-string is still non-empty — but more directly, any future `prompt_fn` that yields `""`). `complete()` raises `ValueError("prompt must be non-empty")` (claude_cli.py:142-143). `map._one` only catches `ClaudeCliError`, so the `ValueError` propagates out of `pool.map`, aborting the entire `run_judge` batch — every other item's judgment is lost, and the exception bubbles up past `lifecycle_audits.judge`/`submission_eval.judge` (which have no try/except), failing the whole CLI run.
- **Root cause**: The batch's "a single bad prompt can't sink a sweep" guarantee (docstring, claude_cli.py:188-190) only holds for `ClaudeCliError`. `complete` can also raise `ValueError`, and `pool.map` re-raises the first exception from any worker.
- **Impact**: One degenerate item turns a whole eval/audit sweep into a crash, losing all valid judgments and exiting non-zero. The blast radius is the entire batch, not the one bad item — the opposite of the intended isolation.
- **Fix sketch**: In `_one`, catch `Exception` (or at least `(ClaudeCliError, ValueError)`) and return it when `return_exceptions`; have `run_judge` skip any non-`ClaudeResult` result (it already special-cases `ClaudeCliError` at llm_judge.py:40 — broaden to "not a ClaudeResult → skip").

## 5. Deterministic `evaluate_submission` crashes if a probe outcome is not a dict
- **Severity**: Medium
- **Category**: edge-case
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/devcase/evaluate.py:115
- **Scenario**: `evaluate_submission` is called (e.g. by a future caller, a test, or a re-run on a stored ToolingSignal) with a `tooling` dict whose `probeOutcomes` came from a source other than this module's `assess_tooling` coerce — for instance a hand-built fixture or a stored artifact where `probeOutcomes` is `["p1 handled", "p2 missed"]` (list of strings) or contains a `None`. The deterministic branch runs `sum(1 for o in outcomes if o.get("handledWell"))` and raises `AttributeError: 'str' object has no attribute 'get'`.
- **Root cause**: Line 115 (and the LLM-coerce path generally) assumes every element of `probeOutcomes` is a dict, unlike `mint_followups` which defensively filters `[o for o in (...) if isinstance(o, dict)]` (evaluate.py:246) and `assess_tooling.coerce` which filters by `isinstance(p, dict)` (reflect.py:234). `evaluate_submission` is the only consumer that does not guard.
- **Impact**: A malformed/stored ToolingSignal turns a recoverable degradation into an unhandled exception. In the CLI it maps to a 500 engine_error; in the eval harness `run_one` it is caught and the row is marked `source="error"` (inflating not_evaluable). Inconsistent hardening across sibling functions is the smell.
- **Fix sketch**: Mirror `mint_followups`: `outcomes = [o for o in (tooling.get("probeOutcomes") or []) if isinstance(o, dict)]` before the comprehension on line 114.

## 6. `analyze_need` deterministic complexity ignores all but one repo and de-dupes stack case-insensitively, hiding multi-repo divergence
- **Severity**: Low
- **Category**: edge-case
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/devcase/analyze.py:99-100
- **Scenario**: A role spans three snapshots: a 5k-LOC service, a 5k-LOC library, and one snapshot whose `loc` field is `0` (a private repo where the LOC probe failed but the stack was still inferred). The deterministic fallback computes `loc = sum(s.loc) = 10_000` → `complexity = "medium"`, and a repo that contributed real stack signal but `loc=0` is invisible to the complexity tier. With the LLM down (the case this fallback exists for), a genuinely large multi-repo role can be under-classified.
- **Root cause**: Complexity is a single global LOC threshold (analyze.py:100) with no per-repo floor and no handling for `loc=0` snapshots that nonetheless carry stack/dirs. There is no signal that one repo's size was unmeasured.
- **Impact**: Low — only the deterministic fallback, and complexity is a coarse hint — but it silently mis-tiers multi-repo roles and a `loc=0` snapshot vanishes from the size narrative, weakening the "ungrounded vs grounded" honesty the module is built around.
- **Fix sketch**: Skip/flag snapshots with `loc <= 0` when tiering, or tier on `max(per-repo loc)` plus count; note in the reflection when a snapshot's size was unmeasured.

## 7. `mint_followups`/`evaluate` reward the deterministic fallback for handling probes it never actually assessed
- **Severity**: High
- **Category**: silent-failure
- **File**: C:/Users/mkdol/dolla/kp/pipeline/jobfit/devcase/evaluate.py:115,119 (with reflect.py:218-228 `assess_tooling` deterministic)
- **Scenario**: Run the full evaluate chain in `--no-llm` mode (or after every LLM step error-fell-back, per finding #1). `assess_tooling`'s deterministic fallback emits one outcome per probe with `detected: False, handledWell: False` and note `"insufficient signal (deterministic)"` (reflect.py:221-223) — i.e. it explicitly assessed nothing. `evaluate_submission` then computes `handled = sum(handledWell)/len(outcomes) = 0/3 = 0.0`, so `judgment = _pct(0.5*verif + 0.5*0.0)`. That is correct here. BUT the inverse failure is live: when `probeOutcomes` is *empty* (no probes supplied, or probes stripped), `handled` defaults to `0.5` (evaluate.py:115, the `else 0.5`), and `judgment` gets a free 0.25 contribution as if half the probes were handled — even though zero probes were even examined. A submission for a case with no cover probes scores judgment as if it half-passed an assessment that never ran.
- **Root cause**: The "no outcomes" branch uses a neutral `0.5` midpoint for `handled`, conflating "no probes to assess" with "probes assessed, half handled". The deterministic fallback's own self-reported "insufficient signal" is discarded — `evaluate_submission` reads only the boolean `handledWell`, never the confidence (which is deliberately 0.2, models.py:60).
- **Impact**: Cases that legitimately ship with 0 probes (or where probes were dropped upstream) get an inflated judgment score that reads as a real assessment — scoring success-theater on the single most fairness-critical dimension. Because confidence is ignored, a 0.2-confidence deterministic run feeds the same judgment number into transfer/credit as a high-confidence LLM run.
- **Fix sketch**: Treat empty `probeOutcomes` as "no signal" (drop the `handled` term and renormalize the judgment weights, or floor it rather than assume 0.5). Propagate `tooling["confidence"]` into the evaluation so a low-confidence trace cannot push a confident-looking judgment score.
