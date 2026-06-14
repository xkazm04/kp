> Total: 4 findings (Crit/High/Med/Low: 0/0/3/1)

Scope: the `dev-case-python-engine` context (26 Python files — the `pipeline/jobfit/devcase/*` engine + `pipeline/jobfit/eval/*` golden-set harness). All files read in full. Every DEAD/UNUSED claim was grepped repo-wide under `C:\Users\mkdol\dolla\kp` (TS bridge spawns in `app/**`, `test_*.py`, and `*_cli.py` / `__main__.py` entrypoints). Bridge/CLI entrypoints verified LIVE before being excluded from dead-code flags:
- `pipeline.jobfit.devcase.devcase_cli` — spawned at `app/_lib/devcase-run.ts` (lines 72, 115, 159, 201, 257, 337, 397, 474, 577); its `source` subcommand IS reached (`devcase-run.ts:578`, `--candidates-json` at :581) and `source.source_candidates` is also test-covered (`tests/test_devcase_source.py`, `tests/test_devcase_cli.py:99`). NOT dead.
- The eval entrypoints (`lifecycle_eval`, `submission_eval`, `eval/__main__`→`runner`, `eval/automation_eval`, `eval/matching_eval`, `eval/seed_cv_fixtures`) are `python -m …` developer/CI harnesses (documented in their module docstrings), not TS-spawned, but are live tooling — not flagged dead.

No genuinely-dead module or helper was found in this context.

## 1. Seven dev-case/eval CLIs hand-roll the stdio-UTF-8 block the shared `configure_stdio()` helper exists to own
- **Severity**: Medium
- **Category**: duplication
- **File**: `pipeline/jobfit/devcase/devcase_cli.py:169-171`, `pipeline/jobfit/devcase/lifecycle_eval.py:216-217`, `pipeline/jobfit/devcase/submission_eval.py:456-457`, `pipeline/jobfit/eval/runner.py:550-552`, `pipeline/jobfit/eval/automation_eval.py:394-395`, `pipeline/jobfit/eval/matching_eval.py:367-368`, `pipeline/jobfit/eval/seed_cv_fixtures.py:425-427` (consolidation target already exists: `pipeline/jobfit/_cli.py:21-26` `configure_stdio()`)
- **Evidence**: `_cli.configure_stdio()` was created specifically to centralize the `if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8"); sys.stderr.reconfigure(...)` block (its module docstring at `_cli.py:1-11` states this is its purpose). `grep "configure_stdio"` over the repo shows only `match_cli`/`reasoning_cli`/`matrix_cli` call it — every CLI in THIS context hand-rolls the block instead. `grep "reconfigure(encoding"` returns 7 in-scope copies (above). The kp convention in the assignment is explicit: "flag CLIs that hand-roll it instead." Two behavioural sub-variants exist among the copies, which is itself drift: `devcase_cli.py` reconfigures BOTH stdout and stderr with no `errors=`; the six eval CLIs use `errors="replace"` and several reconfigure stdout only (`lifecycle_eval`, `submission_eval`, `automation_eval`, `matching_eval` omit the stderr line). The sibling report `scoring-extraction-engine-python.md` finding #1 already flagged this same helper for the OTHER (out-of-scope) CLIs; these seven files are distinct and uncovered by it.
- **Impact**: The exact bug the helper prevents — a Windows cp1250 console mangling Czech diacritics in a spawned CLI's JSON/report output — can silently reappear on any of these, and an encoding-policy change must be edited in seven more places. The stdout-only vs stdout+stderr and `errors=` divergence is live drift that a single helper would erase.
- **Fix sketch**: Add an optional `errors: str = "strict"` parameter to `configure_stdio()` (it currently takes none) so the `errors="replace"` callers are preserved, then replace each inline block with `from .._cli import configure_stdio` (devcase) / `from .._cli import configure_stdio` (eval) + `configure_stdio(errors="replace")` (or default for `devcase_cli`). Pure internal substitution; no entrypoint signature changes. Callers to update: the seven `main()` functions listed above.

## 2. `_str_list` validation helper duplicated verbatim across four devcase artifact modules
- **Severity**: Medium
- **Category**: duplication
- **File**: `pipeline/jobfit/devcase/analyze.py:33-36`, `pipeline/jobfit/devcase/design.py:95-98`, `pipeline/jobfit/devcase/evaluate.py:50-53`, `pipeline/jobfit/devcase/reflect.py:55-58`
- **Evidence**: All four define byte-identical bodies:
  ```python
  def _str_list(value: Any) -> list[str]:
      if not isinstance(value, list):
          return []
      return [str(x).strip() for x in value if str(x).strip()]
  ```
  These four modules are the LLM-artifact producers and each calls `_str_list` heavily inside its `coerce()` to sanitize model output. `grep "def _str_list"` confirms the four are identical (the `automation.py:104` and `jobs.py:172` variants take a `limit` param and a different signature, so they are deliberately separate and out of scope). The four also each define an identical `_generate()` wrapper around `provenance.generate_with_fallback` — but those carry a module-specific `_SYSTEM`/`_LOG` closure and are arguably clearer kept local; `_str_list` has no such per-module dependency.
- **Impact**: A change to coercion policy (e.g. de-duplicating, capping length, normalizing case) must be made in four places or the four steps silently diverge in how they clean LLM lists — exactly the drift `provenance.py` and `models.RUBRIC_DIMENSIONS` were centralized to avoid elsewhere in this same package.
- **Fix sketch**: Move the no-arg `_str_list` into `provenance.py` (already the shared home imported by all four via `generate_with_fallback`) or a small `devcase/_coerce.py`, export it, and replace the four local defs with one import. Update the four `coerce()` call sites (import only — call signature is unchanged). Optionally fold in `evaluate._score_int`/`_pct` and `reflect._clamp01` (also pure, also coerce-only) if a shared coerce module is created, but `_str_list` alone is the safe, mechanical win.

## 3. The 5-step provenance envelope assembly is re-implemented per-eval-harness instead of sharing devcase_cli's run-and-collect helper
- **Severity**: Medium
- **Category**: duplication
- **File**: `pipeline/jobfit/devcase/submission_eval.py:205-227` (`run_one`), `pipeline/jobfit/devcase/lifecycle_eval.py:116-136` (`run_one`)
- **Evidence**: Both `run_one` functions run the per-step pipeline, then build the same two derived structures by hand: (a) `src = combine_source(...)` over the per-step sources, and (b) a `fallback_reasons` dict comprehension that lifts `FALLBACK_REASON_KEY` off each artifact —
  ```python
  fallback_reasons = {
      step: art[FALLBACK_REASON_KEY]
      for step, art in ((...steps...))
      if isinstance(art, dict) and art.get(FALLBACK_REASON_KEY)
  }
  ```
  `submission_eval.py:221-225` and `lifecycle_eval.py:130-134` are the same comprehension differing only in the `(step, artifact)` tuple list. `devcase_cli._fallback_reasons` (`devcase_cli.py:103-119`) does the SAME lift (it `.pop()`s instead of reading, because the CLI must keep it out of the model round-trip) — three near-identical implementations of "collect the per-step fallback reasons into a step→reason map." The comment in `lifecycle_eval.py:127-129` even says "see submission_eval.run_one for the full rationale," acknowledging the copy.
- **Impact**: The fallback-reason contract (the key name, the dict-guard, the skip-when-empty rule) lives in three places; a change to how a degraded step is recorded (e.g. capturing a second field, or renaming the key) must be kept in lockstep across `devcase_cli` and both eval harnesses or a harness silently mis-reports the LLM-degraded-vs-clean distinction it exists to surface.
- **Impact note on certainty**: `provenance.py` is already the shared home and already owns `combine_source`, `FALLBACK_REASON_KEY`, and `describe_fallback` — so the seam exists; only the "collect reasons off a list of (step, artifact)" step is duplicated.
- **Fix sketch**: Add one helper to `provenance.py`, e.g. `collect_fallback_reasons(pairs: list[tuple[str, dict]], *, pop: bool = False) -> dict[str, str]`, and have all three call it (`pop=True` for `devcase_cli`, default-read for the two harnesses). Replace the two harness comprehensions and `devcase_cli._fallback_reasons`'s body with the call. Mechanical; the per-step `(name, artifact)` tuple list stays at each call site (it is genuinely per-command).

## 4. Each eval `main()` re-derives the same `_DIMS`/`RUBRIC_NAMES` set from `RUBRIC_DIMENSIONS` (intentional anti-drift, noted Low)
- **Severity**: Low
- **Category**: cleanup
- **File**: `pipeline/jobfit/devcase/evaluate.py:33` (`_DIMS = tuple(...)`), `pipeline/jobfit/devcase/submission_eval.py:53` (`_DIMS = {...}`), `pipeline/jobfit/devcase/lifecycle_eval.py:38` (`RUBRIC_NAMES = {...}`)
- **Evidence**: Three modules each compute `{d["name"] for d in RUBRIC_DIMENSIONS}` (one as an ordered tuple, two as sets). Per the assignment's kp-conventions note, deriving from the single source of truth in three places is the DELIBERATE anti-drift pattern (each comment says so: e.g. `submission_eval.py:51-52` "mirroring evaluate._DIMS … so the validator's dimension set can never drift from the rubric it checks"). This is therefore NOT a bug — flagged Low only because a one-line shared `RUBRIC_NAMES`/`RUBRIC_DIM_ORDER` constant exported from `models.py` (alongside `RUBRIC_DIMENSIONS`) would remove the three re-derivations while keeping the same single-source guarantee.
- **Impact**: Cosmetic. No correctness risk; the current code already cannot drift from the rubric. Pure tidiness.
- **Fix sketch**: In `models.py`, export `RUBRIC_NAMES = {d["name"] for d in RUBRIC_DIMENSIONS}` and `RUBRIC_ORDER = tuple(d["name"] for d in RUBRIC_DIMENSIONS)` next to `RUBRIC_DIMENSIONS`; import them where the three local copies are. Safe only if `evaluate._DIMS` keeps its ordered (tuple) form — it is iterated for the ordered breakdown — so import `RUBRIC_ORDER` there and `RUBRIC_NAMES` in the two set consumers. Low priority; leave if churn isn't wanted.
