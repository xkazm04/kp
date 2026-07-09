# Pipeline Test Suite (Python) — bug-hunter + ui-perfectionist scan

> Context: The pytest/unittest suite that quality-gates the Python engine — matching, profiling, taxonomy contracts, fairness, devcase, LLM layer, salary/score sanity, and cross-language prompt-version sync.
> Files reviewed: 32 of 65
> Total: 5

The suite is genuinely disciplined: deterministic factories, no live network/subprocess, real recording fakes (`_CaptureProvider`), and many explicit "not green-theater" guards. The residual weaknesses are all in the *coupling/contract* tests — the ones whose whole job is to fail when two sources drift. Several of them can be quietly bypassed, and one prior-scan tautology is still live. (Grep confirms the `X and 0` short-circuit exists ONLY in winnability, and the only unpinned clock read is the known one — see the STILL-OPEN note.)

## 1. [STILL-OPEN] Winnability "demote raises qualified count" still asserts a tautology

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: success-theater / tautological-assertion
- **File**: `pipeline/jobfit/tests/test_winnability.py:52` (subject: `pipeline/jobfit/winnability.py`)
- **Scenario**: Four candidates lack Kafka; a Kafka `must_have` caps the qualified pool. The test claims demoting Kafka *raises* the qualified count, but asserts `self.assertGreaterEqual(kafka["qualifiedDelta"], out["qualified"] and 0)`.
- **Root cause**: `out["qualified"] and 0` short-circuits to `0` whenever `out["qualified"]` is truthy, and to `0` when it is `0` — so the right-hand side is **always 0**. The assertion degrades to `qualifiedDelta >= 0`, a non-negativity check, not the intended direction/magnitude invariant. Prior scan (2026-06-20 #1) reported this; I verified via `grep` it is the sole such short-circuit in the suite and the line is unchanged.
- **Impact**: The headline winnability value prop ("a must-have nobody has is capping the field; demoting it lifts the pool") ships unprotected. A refactor that makes `qualifiedDelta` regress to exactly 0 (lever does nothing) stays green — only the *ranking* line below it (`looseMustHaves[0]["skill"] == "kafka"`) is really tested.
- **Fix sketch**: Replace with `self.assertGreater(kafka["qualifiedDelta"], 0)`. Add a lint/CI grep banning `and 0` / `or N` in any `assert*` right-hand side — this idiom silently kills assertions.

## 2. Prompt-version freshness is guarded for the reasoning cache but NOT the main analysis cache

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: coverage-gap / silent-failure
- **File**: `pipeline/jobfit/tests/test_prompt_version_sync.py:27-36` (gap vs `app/_lib/cache-key.ts:8-26`, `app/_lib/cache-key.test.ts:72-76`)
- **Scenario**: The suite's one cross-language freshness guard pins `REASONING_PROMPT_VERSION` (Python↔`reasoning-run.ts`). But the far higher-stakes **main analysis cache** keys only on `PROMPT_VERSION` + inputs (`cache-key.ts:67-77`) — it never hashes the prompt text/schema. Its own comment says a dev must manually bump the version "when the Gemini prompt, the Pydantic schema, the deterministic pre-pass, or the taxonomy changes" — all Python-side. No test enforces that bump; `cache-key.test.ts:72` only asserts `PROMPT_VERSION.startsWith("v5-")`, a tautology.
- **Root cause**: The suite already uses content-coupling guards for lesser contracts (`test_profile_taxonomy_contract.test_generated_ts_is_in_sync`, `test_pipeline_diagram_contract`) but applies none to the analysis cache — its single biggest staleness surface.
- **Impact**: A Python analysis-prompt/schema/taxonomy edit with no `PROMPT_VERSION` bump silently serves **stale cached analyses** to recruiters — wrong results, no error, invisible in CI. Exactly the failure the reasoning-sync test was built to prevent, left open on the more consequential cache.
- **Fix sketch**: Add a Python test pinning a content-hash of the analysis prompt + Pydantic schema + `taxonomy.json` to a recorded value that must be updated in lockstep with `cache-key.ts::PROMPT_VERSION` — mirroring the codegen `--check` pattern already used elsewhere.

## 3. The "impossible to reintroduce" early-career guard has real bypass holes

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: coverage-gap / validation-gap
- **File**: `pipeline/jobfit/tests/test_early_career_single_source.py:42-45, 63-89`
- **Scenario**: This file guards the most safety-critical invariant (early-career candidates are never auto-advanced/rejected). `test_no_shadowed_literal_in_python_sources` promises the hand-copied `("student","career_switcher")` set "cannot be reintroduced anywhere." But `_SHADOWED_LITERAL_RE` only matches `(...)`/`[...]` brackets — a **set/frozenset literal** `{"student","career_switcher"}` or a bare tuple `x = "student","career_switcher"` sails through. And `test_every_consumer_derives_from_the_registry` checks only **4 hardcoded module attributes**; a 5th consumer added later is not covered by either guard.
- **Root cause**: Enforcement is by brittle regex + a static allow-list, not by a structural rule ("no module defines its own early-career set"). The most natural Python idiom for this set — a `{...}` literal — is precisely the one the regex misses.
- **Impact**: A new module that hardcodes `{"student","career_switcher"}` and later drifts from `archetypes.json` would mis-route a fairness-protected candidate with zero error — the exact silent failure this test claims to make impossible.
- **Fix sketch**: Add `{`/`}` (and `frozenset(`) to the regex; or replace both with an AST/import-graph check that flags any module referencing both literals outside `registry`. Assert the consumer list is exhaustive (grep the package for `_EARLY`/`early_career` module attrs and require each equals the registry).

## 4. Pipeline-diagram contract is one-directional and its parsing regexes can mask a dead step

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: coverage-gap / silent-failure
- **File**: `pipeline/jobfit/tests/test_pipeline_diagram_contract.py:20-43`
- **Scenario**: The test fails CI only when a `STEP_DETAILS` key has no `.puml` alias (keys ⊆ aliases). The reverse — a clickable diagram node with no `STEP_DETAILS` (a step that no-ops on click) — is, by the test's own comment, only a dev-mode console warning, never a CI failure. Worse, `_puml_aliases` harvests every `\bas\s+(\w+)` in the file, so any prose/label containing "…as ingest…" injects a phantom alias that can mask a genuinely orphaned key; and `_step_detail_keys` only matches keys written as `^  key: {` (2-space indent, brace same line) — a reformat or quoted key silently shrinks the checked set, and the `assertTrue(keys)` guard catches only a *total* miss, not a partial one.
- **Root cause**: Text-regex coupling over two files whose formats can each drift independently, with only one enforced direction.
- **Impact**: A user clicks a pipeline step and it silently does nothing; CI stays green. Low blast radius (UX papercut on an internal diagram) but the guard advertises more protection than it delivers.
- **Fix sketch**: Parse `.puml` aliases from node-definition lines only (anchor the `as` to a rectangle/node token), assert both directions (fail on aliases the TS marks clickable but omits from `STEP_DETAILS`), and make the key regex tolerant of quotes/indentation so a reformat can't shrink the set.

## 5. `_extract_ts_const` is a double-quote-only, first-match regex — the one real coupling guard is fragile

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case / brittle-assertion
- **File**: `pipeline/jobfit/tests/test_prompt_version_sync.py:20-24`
- **Scenario**: `re.search(rf'{name}\s*=\s*"([^"]+)"', text)` extracts the Node `REASONING_PROMPT_VERSION`. It matches only **double-quoted** literals and the **first** occurrence, unanchored. If a lint/format change rewrites the const with single quotes, the test raises `AssertionError("could not find …")` — a red build with no real drift. And because it takes the first match, a commented-out earlier line (`// REASONING_PROMPT_VERSION = "old"`) would be compared instead of the live const, letting a genuine drift pass or fail against the wrong value.
- **Root cause**: A hand-rolled regex substituting for a parse of the actual exported constant; it encodes an incidental style (double quotes, single definition) as a contract.
- **Impact**: The suite's *only* load-bearing cross-language freshness check is quote-style-fragile (false red on a reformat) and comment-fragile (false green/red on a stale commented line). Low likelihood, but it undermines the one guard the whole `test_prompt_version_sync` file exists to provide.
- **Fix sketch**: Accept both quote styles (`["']([^"']+)["']`), require a word boundary before `name`, and reject matches inside `//`/`/* */` comments (or import the value via a tiny `tsx`/`node -e` eval so the parse is authoritative).
