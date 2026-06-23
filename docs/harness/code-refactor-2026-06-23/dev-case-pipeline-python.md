> Total: 6 findings (0c critical, 1h high, 2m medium, 3l low)

## 1. Four byte-identical `_generate` wrappers across analyze/design/evaluate/reflect
- **Severity**: High
- **Category**: duplication
- **File**: pipeline/jobfit/devcase/analyze.py:28-31, pipeline/jobfit/devcase/design.py:97-100, pipeline/jobfit/devcase/evaluate.py:44-47, pipeline/jobfit/devcase/reflect.py:52-55
- **Scenario**: All four modules define the same private wrapper:
  `def _generate(provider, prompt, deterministic, coerce) -> tuple[dict, str]: return generate_with_fallback(provider, prompt, _SYSTEM, deterministic, coerce, _LOG)`.
  Verified with `rg -n "^def _generate"` (4 hits) and `rg -n "generate_with_fallback\(provider, prompt, _SYSTEM, deterministic, coerce, _LOG\)"` (4 hits, one per module). The only per-module difference is the closed-over `_SYSTEM` / `_LOG`. The shared comment block above each wrapper is also copy-pasted verbatim.
- **Root cause**: `generate_with_fallback` was extracted into `provenance.py` (which already centralizes the LLM-or-deterministic contract), but the thin per-module wrapper that binds `_SYSTEM`/`_LOG` was left duplicated in each step instead of being collapsed.
- **Impact**: Four places to touch for any signature/logging change to the shared runner; the wrappers can silently drift (e.g. one module passing a different system var). Low-risk but pure boilerplate, called by every generation step.
- **Fix sketch**: Add a small factory to `provenance.py`, e.g. `make_generate(system, logger)` returning a bound `_generate`, and in each module replace the def with `_generate = make_generate(_SYSTEM, _LOG)`. Call sites (`_generate(provider, prompt, deterministic, coerce)`) stay unchanged. Verify the four step modules still import nothing else from the wrapper.

## 2. Dead back-compat aliases `FAMILIES` / `ARCHETYPES` in scenarios.py
- **Severity**: Medium
- **Category**: dead-code
- **File**: pipeline/jobfit/devcase/scenarios.py:156-158
- **Scenario**: Lines 157-158 export `FAMILIES = DOMAINS["it"]["families"]` and `ARCHETYPES = DOMAINS["it"]["archetypes"]` with the comment "the IT domain is the original landscape (other modules import these)". No module imports them. Verified: `rg -n "scenarios\.(FAMILIES|ARCHETYPES)"` → 0 hits; `rg "from .scenarios import"` shows the only devcase importers pull `DOMAINS`, `_DOMAIN_KEYS`, `Scenario`, `generate_mixed`, `generate_scenarios` (lifecycle_eval.py:34, lifecycle_audits.py:22, submission_scenarios.py:27) — never `FAMILIES`/`ARCHETYPES`. The other `FAMILIES`/`ARCHETYPES` grep hits are unrelated definitions in seed_candidates.py / seed_jobs.py / archetype.py.
- **Root cause**: The module was generalized from an IT-only landscape (`FAMILIES`/`ARCHETYPES`) to the multi-domain `DOMAINS` table; the old top-level names were kept "for back-compat" but every consumer migrated to `DOMAINS`/`_DOMAIN_KEYS`, leaving the aliases orphaned with a now-false comment.
- **Impact**: Misleading comment plus two dead module-level names a reader assumes are a live contract. Risk of someone wiring new code to the stale IT-only view instead of `DOMAINS`.
- **Fix sketch**: Delete lines 156-158. No import updates needed (grep-confirmed no consumers). If a public alias is genuinely wanted, keep one but correct the comment to "no current importers".

## 3. Unused `scn` parameter on the three lifecycle `_check_*` validators
- **Severity**: Medium
- **Category**: dead-code
- **File**: pipeline/jobfit/devcase/lifecycle_eval.py:55, :67, :76
- **Scenario**: `_check_analysis(a, scn)`, `_check_role(r, scn)` and `_check_case(c, scn)` all accept a `scn: Scenario` arg that no body reads — confirmed by `sed -n '55,95p' | grep scn`, which matches only the three signature lines, never inside the bodies (they read solely from `a`/`r`/`c`). Contrast submission_eval.py:154 `_check(..., scn)` which genuinely uses `scn.case["coverProbes"]`, so the symmetry that motivated the param doesn't apply to the design half.
- **Root cause**: Copied the `(artifact, scn)` shape from the submission validator for signature symmetry; the planted-scenario context was never actually needed on the design-half checks.
- **Impact**: Dead parameter that implies these validators are scenario-aware (e.g. could check planted gaps) when they aren't — a reader-misleading API surface. Harmless at runtime.
- **Fix sketch**: Drop the `scn` parameter from all three defs and update the single call site `_check_analysis(a, scn) + _check_role(r, scn) + _check_case(c, scn)` at line 132 to drop the arg. Or, if scenario-aware checks are intended (e.g. assert `realStack` reflects the planted snapshot), implement them — but absent that, remove the unused param.

## 4. Two same-named `_clamp01` helpers with different contracts
- **Severity**: Low
- **Category**: duplication
- **File**: pipeline/jobfit/devcase/reflect.py:58, pipeline/jobfit/devcase/process_events.py:21
- **Scenario**: Both modules define `_clamp01`, but with deliberately different signatures/behaviour: reflect's is `_clamp01(value, default)` (coerces, NaN→`default`); process_events' is `_clamp01(x)` (NaN→0.0, no default, no float-coercion guard). Verified via `rg -n "def _clamp01"`. Not a true copy, but the identical name across sibling modules invites confusion (a reader may assume one contract).
- **Root cause**: Each module grew its own clamp independently; reflect needed the LLM-fallback `default`, process_events (pure/deterministic) didn't.
- **Impact**: Minor cognitive cost; risk that a future edit "unifies" them and accidentally changes the NaN-or-default semantics one path relies on.
- **Fix sketch**: Leave as-is OR rename for intent (e.g. `_clamp01_or` in reflect, `_clamp01` in process_events) — do NOT naively merge, since the default-vs-zero NaN handling differs by design. Low priority; document the distinction if kept.

## 5. Repeated local `from ..i18n import language_directive` import (4 sites)
- **Severity**: Low
- **Category**: structure
- **File**: pipeline/jobfit/devcase/design.py:148 and :286, pipeline/jobfit/devcase/interview_scenario.py:201, pipeline/jobfit/devcase/seed_materializer.py:188
- **Scenario**: `language_directive` is imported function-locally at four call sites, including twice inside design.py (once in `design_role`, once in `design_case`). Verified with `rg -c` (design.py: 2). Function-local imports are sometimes used to dodge cycles, but `..i18n` is also imported at module top elsewhere in the package (e.g. normalize_lang in devcase_cli), so a cycle is unlikely to be the reason here.
- **Root cause**: Each language-threading change (DEVP5/JDL5) added the import inline at the new call site rather than hoisting to module scope.
- **Impact**: Minor repetition; a reader can't tell at a glance whether the local import is load-bearing (cycle avoidance) or incidental.
- **Fix sketch**: If `from ..i18n import language_directive` at module top does not introduce an import cycle (quick check: import the module in isolation), hoist it to the top of design.py / interview_scenario.py / seed_materializer.py and drop the four inline imports. If a cycle exists, add a one-word comment ("# local: avoids i18n import cycle") so the intent is explicit.

## 6. Near-identical group-mean closures `mean_j` / `mean_o` / `mean` in submission_eval
- **Severity**: Low
- **Category**: duplication
- **File**: pipeline/jobfit/devcase/submission_eval.py:274-275 (`mean_j`), :321-322 (`mean_o`), :387-395 (`_quality_summary` inline mean)
- **Scenario**: `fairness()` and `discrimination()` each define a tiny `round(sum(...)/len(rs), 1) if rs else None` helper differing only in the attribute summed (`r.judgment` vs `r.overall`). The pattern recurs in `_quality_summary`. Verified by reading the three functions. Genuinely small, but it is the same empty-guard + round idiom three times.
- **Root cause**: Each gate function grew its own local mean rather than sharing one keyed helper.
- **Impact**: Trivial; only worth noting because the empty-guard (`else None`) is a correctness contract (feeds the tri-state gate logic) that must stay consistent across both gates.
- **Fix sketch**: Optional — a module-level `def _mean(rows, key, ndigits=1): return round(sum(key(r) for r in rows)/len(rows), ndigits) if rows else None`, then `mean_j = lambda rs: _mean(rs, lambda r: r.judgment)`. Marginal benefit; only do it if touching this file for other reasons.
