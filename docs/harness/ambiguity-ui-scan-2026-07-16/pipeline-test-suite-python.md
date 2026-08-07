# Pipeline Test Suite (Python) — ambiguity-guardian + ui-perfectionist scan

> Total: 4 findings (0 critical, 0 high, 2 medium, 2 low)

This is an exceptionally disciplined suite: nearly every test carries a rationale
comment, magic numbers are lifted into named constants, cross-language contracts
are CI-guarded, and regressions are pinned with non-vacuous guards. The findings
below are the residual soft spots — a gap between what a gate *promises* and what
it *mechanically enforces*, an invariant enforced on one code path but not its
sibling, a dead named-threshold, and a collection-time dependency asymmetry. The
context is pure Python test infrastructure with no direct pixel surface, so all
findings come from the Ambiguity Guardian lens (per the brief, expected here).

## 1. `run_gated` skip tripwire is count-based, so a swapped-in critical skip slips through
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-assumption
- **File**: `pipeline/jobfit/tests/run_gated.py:45`
- **Scenario**: A developer (or CI on a machine that happens to have a `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or the personal-CV fixtures present) runs `npm run test:python:gate`. One of the four *tolerated* skips stops skipping — e.g. `test_gemini_pdf_extraction_returns_structured_skills` now runs because a key is set, or the two `test_pdf_parsing_quality` fixture tests run because the repo author has `linkedin-profile.pdf`/`technical-cv.pdf` locally. At the same time a genuinely *critical* test newly starts skipping (a removed fixture, an unset env). The total skip count stays at or below the baseline of 4, so the tripwire never fires.
- **Root cause**: The gate compares `len(result.skipped) > SKIP_BASELINE` (line 45) — a scalar count, not the *identity* of the skipped tests. The module docstring, however, promises "a newly-skipping test trips CI instead of disappearing into a green run" (lines 5–6). That promise only holds when the total rises; a 1-for-1 swap (a tolerated skip going green while a critical one goes red) is invisible. `ALLOW_SKIP=1` (line 43) also disables the check wholesale before the count is even consulted.
- **Impact**: The exact silent-skip failure the wrapper exists to prevent can still occur on any environment where the tolerated-skip set is not the precise keyless-CI set enumerated in `.github/workflows/ci.yml:91-100` — which notably includes the maintainer's own machine (fixtures + keys present).
- **Fix sketch**: Track the tolerated skips by test id, not by count: keep an explicit allow-set of `{test.id() → reason}` and fail when `result.skipped` contains any id **not** in that set (regardless of total), OR when a *required* id is missing from the run entirely. That turns the swap case into a hard failure and makes the ci.yml derivation the single source of truth instead of a comment that must be kept in sync with an integer.

## 2. `group_compare` LLM path forwards the misleading skill ratio the deterministic path was deliberately purged of
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: one-sided-invariant
- **File**: `pipeline/jobfit/tests/test_group_compare.py:169`
- **Scenario**: A recruiter opens "compare all" with a live LLM provider. The model returns a keyPoint like `**Alice** covers **3/4** must-haves.` — a `matched/(matched+missing)` fraction. It renders verbatim in the Decisions comparison panel.
- **Root cause**: `CoverageMetricTest` (lines 83–151) pins a hard-won fix: the *deterministic* synthesis must never present the mixed-population `matched/(matched+missing)` ratio (`assertNotIn("5/6", …)`, `assertNotIn("covers the most required skills", …)`) because it conflates must-haves with nice-to-haves and reads misleadingly. But `test_provider_success_is_coerced` (lines 169–181) encodes an LLM keyPoint containing exactly `**3/4** must-haves` and asserts it is passed through unchanged. Confirmed in production: `group_compare._coerce` (`group_compare.py:160-172`) only `.strip()`s LLM keyPoints — it applies no ratio sanitization — so the honesty invariant is enforced on the deterministic branch and merely *requested* (via the prompt) on the LLM branch.
- **Impact**: The precise misleading fraction that was engineered out of one code path re-enters through the other, undermining the fix whenever a provider is configured (the normal production path). Recruiter-facing coverage claims become inconsistent depending on whether the LLM call succeeded or fell back.
- **Fix sketch**: Move the ratio-sanitization into `_coerce` (or a shared post-processor both paths call) so an LLM keyPoint carrying a `N/M must-haves` fraction is rewritten to the unmet-must-have phrasing, and add a `test_coerce_strips_mixed_ratio_from_llm_points` guard mirroring `CoverageMetricTest`. Enforce the invariant at the boundary, not per-branch.

## 3. `MIN_LINKEDIN_TEXT_LEN` is a dead named-threshold while its one call site hard-codes the literal
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: magic-number
- **File**: `pipeline/jobfit/tests/_helpers.py:15`
- **Scenario**: A developer updates what "a real LinkedIn export is at least this long" means and edits `MIN_LINKEDIN_TEXT_LEN = 5000` in `_helpers.py`, expecting the LinkedIn-extraction quality test to follow. It does not — that test keeps asserting against a raw `5000`.
- **Root cause**: `_helpers.py` documents its constants as "Named thresholds, replacing inline magic numbers across the suite" (line 11), but `MIN_LINKEDIN_TEXT_LEN` is imported by **no** module (verified across the suite), while `test_pdf_parsing_quality.py:35` — the exact assertion the constant describes (`assertGreater(summary["length"], 5000)`) — inlines the literal `5000` instead. The one constant meant to kill an inline magic number is itself dead, and the magic number it names still lives.
- **Impact**: A named-threshold that silently diverges from its real usage; the module's stated intent is quietly violated by its own unused member. Harmless today, but exactly the drift the named-constants convention exists to prevent.
- **Fix sketch**: Import `MIN_LINKEDIN_TEXT_LEN` in `test_pdf_parsing_quality.py` and replace the inline `5000` with it, so the threshold has a single home. (If the constant is deliberately aspirational, delete it — a dead threshold is worse than an honest literal.)

## 4. The test package hard-requires `python-dotenv` at collection, where production degrades gracefully
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: hidden-assumption
- **File**: `pipeline/jobfit/tests/__init__.py:37`
- **Scenario**: Someone runs the suite in a stripped/hermetic environment that omits `python-dotenv` (a config production explicitly tolerates). Instead of a clear "missing dev dependency" message, **the entire suite fails to collect** with a `ModuleNotFoundError` raised from the tests package `__init__`, before a single test runs.
- **Root cause**: `__init__.py:37` unconditionally does `_mock.patch("dotenv.load_dotenv", …).start()`, which imports `dotenv` eagerly. But production treats dotenv as optional: `gemini.py:13-16` wraps `from dotenv import load_dotenv` in `try/except` and no-ops when it is absent, and `llm/base.py:77-87` imports it lazily inside `load_local_env`. So the guard makes a dependency mandatory at test-collection time that the code under test deliberately makes optional — an undocumented asymmetry.
- **Impact**: Low in practice (`requirements.txt:4` pins `python-dotenv>=1.0.1`, so CI always has it), but the failure mode is opaque and contradicts the production contract; a future minimal-deps test lane would break confusingly at import rather than skip cleanly.
- **Fix sketch**: Guard the patch the same way production does — `try: import dotenv; _mock.patch("dotenv.load_dotenv", …).start() except ImportError: pass` — and add a one-line comment noting the guard mirrors `gemini.py`'s optional-dotenv handling. The Layer-2 SDK stub already tolerates absence; align Layer 1 with it.
