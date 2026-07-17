# LLM Provider Layer (Python) — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 2 medium, 2 low)

## 1. Capability matrix advertises `file_input` for adapters that are text-only
- **Severity**: High
- **Lens**: ambiguity
- **Category**: capability-matrix-drift
- **File**: `pipeline/jobfit/llm/capabilities.py:17`
- **Scenario**: An operator routes the flagship CV path via `KP_LLM_CONFIG` — `{"useCases": {"cv_analysis": {"provider": "openai"}}}` (or `anthropic` / `gemini`). `unsupported_caps("cv_analysis", "openai")` = `{file_input} - {json, file_input}` = ∅, so the registry green-lights it and returns an `OpenAIProvider` / `GeminiProvider`. But every adapter in this layer implements only text `_call(prompt: str, ...)` — `gemini_api.py:32` sends `contents=[prompt]`, no file. The CV attachment is silently dropped and the model analyzes an empty/placeholder prompt.
- **Root cause**: `PROVIDER_CAPABILITIES` (lines 17-20) declares `CAP_FILE_INPUT` for anthropic/openai/azure/gemini, but the multimodal path deliberately still lives in `gemini.py` (`gemini_api.py:3-6` — "stays in gemini.py until Phase 3"). The matrix is forward-looking; the adapters are not there yet. The registry's own stated purpose (`capabilities.py:5-8`: "a wildcard config entry can't silently route `cv_analysis` to a text-only provider") is therefore only half-true: it blocks `claude_cli` (which lacks the cap) but waves through four adapters that also cannot actually accept a file.
- **Impact**: A misconfiguration the matrix exists to prevent produces a wrong hiring-relevant analysis instead of a fail-loud error. `test_llm_registry.py:155-169` only exercises the `claude_cli` reject case, so the gap is untested and invisible.
- **Fix sketch**: Until an adapter truly handles file input, drop `CAP_FILE_INPUT` from the anthropic/openai/azure/gemini rows (leave `claude_cli`-style text caps), so `cv_analysis` / `profile_extract` raise for every provider in this layer rather than silently degrading. Re-add the cap per provider only when its adapter's `_call` actually attaches files, and add a registry test asserting `cv_analysis` → `openai`/`gemini` raises today.

## 2. `is_transient_error` substring match retries permanent failures
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: over-broad-retry-classification
- **File**: `pipeline/jobfit/llm/base.py:129`
- **Scenario**: A permanent 4xx (bad model name, invalid request) whose error text happens to contain a 3-digit marker is classified transient and retried three times. The classifier lowercases `f"{type(exc).__name__}: {exc}"` and does a bare substring test for `"429"`, `"502"`, `"503"`, `"504"`, `"529"`, `"timeout"`, etc. A message like `invalid model 'claude-sonnet-4-6-20250529'` contains the substring `529`; a validation error mentioning a token limit like `...must be < 4295` contains `429`.
- **Root cause**: The digit markers are matched anywhere in the free-form message rather than against the structured `code`/`status_code` (which is already checked separately, lines 124-128). Any incidental digit run or the word "timeout" appearing in a permanent error's prose trips the transient path.
- **Impact**: Wasted wall-clock (up to `_MAX_ATTEMPTS` × per-attempt) and, for a metered adapter, up to two extra paid retries on a request that can never succeed, plus a delayed fallback for the user.
- **Fix sketch**: Prefer the structured status code as the sole numeric signal (already handled at lines 124-128) and drop the bare `"429"/"502"/…"` string markers, keeping only unambiguous phrase markers (`"rate limit"`, `"resource_exhausted"`, `"overloaded"`, `"deadline_exceeded"`). If a textual code check is still wanted, require a word-boundary/`http` context so a model-name date or token count can't match.

## 3. Invalid `maxTokens` / `timeoutS` are silently dropped despite the fail-loud contract
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-config-fallback
- **File**: `pipeline/jobfit/llm/config.py:66`
- **Scenario**: An admin sets `"params": {"timeoutS": "30s"}` or `"maxTokens": 0` (or `-1`, or `"4k"`). `_int_or_none` returns `None` for every non-positive-int / non-digit value, so the field is quietly ignored and the request runs with the 180s / 2048-token default. The admin believes they capped the timeout at 30s; they didn't.
- **Root cause**: The module docstring is explicit — "A malformed config raises (fail loud): silently falling back to a different provider/model would violate the no-silent-model-drift invariant" (lines 23-25) — and structural errors (missing `provider`, non-object `useCases`) do raise. But `params` values take the opposite policy: `_int_or_none` coerces-or-drops (lines 66-73, used at 100-101) with no error, so a typo'd budget silently reverts to a default.
- **Impact**: Silent divergence between the configured and the executed timeout/token budget — the same class of surprise the fail-loud invariant was written to prevent, just one layer down. A 30s intent that silently becomes 180s can blow past the TS spawn's wall-clock kill.
- **Fix sketch**: When `params.maxTokens` / `params.timeoutS` are present but not a positive int (nor a positive-int string), raise `LLMError(f"{ENV_VAR}.useCases[{name!r}].params.timeoutS must be a positive integer")` instead of returning `None`. Keep the silent-drop only for a genuinely absent key.

## 4. Bench mislabels an offline-sealed provider as "missing key/SDK"
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: misleading-diagnostic
- **File**: `pipeline/jobfit/llm/bench/runner.py:127`
- **Scenario**: A self-host operator runs the bench under `KP_OFFLINE=1` against a cloud target. `provider.available()` returns `False` because `_offline_blocked()` sealed it (`base.py:257`), and the matrix records the fixed string `error="provider unavailable (missing key/SDK) — skipped"`. The operator sees "missing key/SDK", double-checks a key that is actually present and correct, and never learns the real cause is the no-egress seal.
- **Root cause**: `available()` collapses three distinct reasons (offline-sealed, no key, no SDK) into one bool, and `run_matrix` hardcodes a single explanatory string for all of them.
- **Impact**: Wasted debugging on a benign, expected condition; the KP_OFFLINE seal — a deliberately load-bearing behavior — is invisible in the one tool built to compare providers.
- **Fix sketch**: Before the generic message, branch on `getattr(provider, "_offline_blocked", lambda: False)()` and emit `"blocked by KP_OFFLINE (cloud egress sealed) — skipped"`; otherwise keep the missing-key/SDK wording. A one-line check that turns a misleading label into an accurate one.

## 5. Azure api-version from `.env.local` is ignored when the endpoint is passed explicitly
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: env-load-ordering
- **File**: `pipeline/jobfit/llm/adapters/azure_openai.py:50`
- **Scenario**: An operator configures the Azure endpoint + key via `KP_LLM_CONFIG` (so `self.endpoint` is set) but leaves `AZURE_OPENAI_API_VERSION` only in `.env.local`. `_resolved_api_version` reads `os.getenv("AZURE_OPENAI_API_VERSION")` without first loading the dotenv file; `_resolved_endpoint` (which does call `load_local_env()`) returns early at line 45 because `self.endpoint` is truthy, so the `.env.local` file is never loaded in this path. The provider silently uses the hardcoded `_DEFAULT_API_VERSION = "2024-10-21"` instead of the operator's pinned version.
- **Root cause**: `_resolved_endpoint` loads the env as a side effect (line 47), and `_resolved_api_version` implicitly relies on that having happened — but when the endpoint comes from a kwarg, the load never runs, so the two methods disagree on whether `.env` has been read.
- **Impact**: A pinned api-version in `.env.local` is silently ignored in the DB-config path, potentially calling a wrong/older Azure API surface than intended; hard to spot because the endpoint path also fails to load it.
- **Fix sketch**: Call `load_local_env()` at the top of `_resolved_api_version` (mirroring `_resolved_endpoint`), or hoist a single `self._load_env()` into `_make_client` before both resolvers run, so dotenv values are honored regardless of where the endpoint came from.
