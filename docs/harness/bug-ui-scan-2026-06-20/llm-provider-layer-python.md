# LLM Provider Layer (Python) — Bug Hunter scan

> Context: Provider-agnostic LLM abstraction — registry + capabilities, per-provider adapters (Anthropic, OpenAI, Azure, Gemini), monitoring/usage ledger, and a benchmarking harness.
> Files reviewed: 18 of 23
> Total: 7 findings — Critical: 0, High: 4, Medium: 2, Low: 1

## 1. Retry timeout budget is per-attempt, so wall-clock can reach 3× the configured timeout

- **Severity**: High
- **Category**: silent-failure / timeout-handling
- **File**: `pipeline/jobfit/llm/base.py:222` (and `:229-264`), `pipeline/jobfit/claude_cli.py:162`
- **Scenario**: A use case is configured with `timeoutS: 120`. The provider hangs on a slow/overloaded backend and trips a transient timeout. `complete()` retries up to `_MAX_ATTEMPTS=3`, and each attempt is handed the FULL `budget = timeout or self.timeout` again (`self._call(..., timeout=budget)`), plus `0.5·2^n` backoff sleeps between them. One logical call can therefore block ~`3·120s + backoff ≈ 370s` (default config: `3·180s ≈ 540s+`).
- **Root cause**: The retry loop treats `budget` as a per-attempt deadline, not a total deadline. There is no monotonic "remaining time" computed from `first_started` and passed down to `_call`.
- **Impact**: The TS `spawnPython` seam that shells out to these CLIs almost certainly enforces its own wall-clock kill. When the Python budget (540s) outruns the parent's kill, the child is SIGKILLed mid-call: the user sees a generic "engine failed", the ledger line for that call is never written (so spend that DID occur on the provider is lost), and `monitor.emit_error` never fires. It also stacks under `map()` — N concurrent calls each able to run 3× over budget.
- **Fix sketch**: Compute `remaining = budget - (time.monotonic() - first_started)` before each attempt; break out (raise the accumulated `last`) when `remaining <= ~1s`; pass `int(remaining)` as the per-attempt `timeout`. This makes the configured timeout a true ceiling.

## 2. Truncated completions (hit max_tokens) are treated as "bad JSON", double-billed, then fail

- **Severity**: High
- **Category**: edge-case / silent-failure / cost
- **File**: `pipeline/jobfit/llm/adapters/anthropic_api.py:51-58`, `pipeline/jobfit/llm/adapters/openai_api.py:40-54`, `pipeline/jobfit/llm/base.py:283-313`
- **Scenario**: A use case returns JSON larger than `DEFAULT_MAX_TOKENS=2048` (e.g. `campaign_pack` with several variants, or a long `match_reasoning` verdict). The model stops at the cap with `stop_reason="max_tokens"` (Anthropic) / `finish_reason="length"` (OpenAI). The adapter captures `stop_reason`/`finish_reason` into `raw` but never inspects it; it returns truncated text as a normal success. `_extract_json` then fails on the unterminated JSON, so `complete_json` fires its self-repair re-prompt — which asks for "the SAME answer" and is *also* capped at 2048 tokens, so it truncates again — then raises `LLMError`.
- **Root cause**: `max_tokens`-truncation is a structural, non-retryable, non-repairable failure mode that the layer does not distinguish from "model returned prose". The repair path cannot fix a length cap and just doubles the spend.
- **Impact**: For any legitimately large answer the use case silently and permanently drops to its deterministic fallback, having paid for TWO truncated completions. The error message ("did not return parseable JSON") misdirects debugging toward prompt/model quality when the real fix is raising `params.maxTokens`.
- **Fix sketch**: In each adapter, if `stop_reason`/`finish_reason` indicates length truncation, raise a typed `LLMError(subtype="max_tokens")` (or set a flag on `LLMResult`). In `complete_json`, skip the self-repair re-prompt for truncation and surface an actionable "increase maxTokens" message.

## 3. `complete_json` self-repair silently double-bills every recoverable JSON slip

- **Severity**: High
- **Category**: cost / metering
- **File**: `pipeline/jobfit/llm/base.py:287-313`
- **Scenario**: The model returns the answer wrapped in a stray sentence or trailing comma that `_extract_json` can't parse. `complete_json` runs a SECOND full `complete()` (the repair re-prompt), which is independently retried AND metered — `monitor.emit_result` / the usage ledger record both calls. Under `map()` this happens per item.
- **Root cause**: The repair is implemented as another billed completion, by design, but nothing caps or flags the doubled cost, and the repair prompt only echoes `result.text[:4000]` — it drops the original task context and system prompt's data, so the "same answer" instruction can drift on long inputs.
- **Impact**: A provider with a chatty formatting habit doubles token spend on a whole batch with no signal in the metering that the second call was a repair (both ledger rows look like first-class calls keyed on the same `use_case`). Budget/COGS dashboards over-attribute "normal" usage and can't see the repair tax.
- **Fix sketch**: Tag the repair call's ledger/telemetry (`use_case=f"{use_case}:repair"` or a `metadata.repair=True`) so it's countable; consider gating the repair behind a config flag for cost-sensitive batch use cases.

## 4. Permanent (non-transient) provider failures bypass the deterministic fallback by raising

- **Severity**: High
- **Category**: error-propagation / silent-vs-loud
- **File**: `pipeline/jobfit/llm/base.py:246-263`, `pipeline/jobfit/llm/registry.py:28` (caller contract in module docstring)
- **Scenario**: The registry docstring promises adapters "report missing keys/SDKs through `available()` → deterministic path; *misconfiguration* raises." But a runtime auth failure (revoked/rotated API key → 401) reaches `complete()` AFTER `available()` already returned True (the key string is present, just invalid). `is_transient_error` correctly classifies 401 as permanent, so `complete()` raises `LLMError` immediately. Call sites that did the `available()`-then-use dance never wrapped the actual call in a try/deterministic-fallback, because the contract led them to believe unavailability is detected up front.
- **Root cause**: `available()` checks key *presence*, not key *validity*; a mid-rotation or wrong key is a runtime permanent error that the "available() gates degradation" contract doesn't cover, so it propagates as a hard failure instead of degrading.
- **Impact**: A single stale key takes down every LLM-backed use case with a 500-class error to the user, instead of the documented graceful degradation to deterministic output. This is exactly the "wakes people up at night" failure for a billing/key rotation event.
- **Fix sketch**: Either document that callers MUST wrap `complete()` in try/fallback for permanent runtime errors too, or have the layer fall back to deterministic for *runtime* permanent errors (401/403) while still raising for *config* errors (unknown provider/capability) — and add a test asserting a 401 mid-call degrades rather than 500s.

## 5. `price_usd` prefix match mis-prices look-alike model families

- **Severity**: Medium
- **Category**: edge-case / cost-accuracy
- **File**: `pipeline/jobfit/llm/base.py:63-67`
- **Scenario**: Cost lookup is `model.startswith(prefix)` over an unordered dict. Today's table is collision-free, but the moment a future config pins, say, `gemini-2.5-flash-lite` (cheaper than `gemini-2.5-flash`) it will prefix-match the `gemini-2.5-flash` row and be billed at the more expensive flash rate. Conversely an operator who pins a bare `gpt-5` gets `cost_usd=None` (no prefix matches) and that traffic silently escapes the cost cross-check.
- **Root cause**: Prefix matching assumes model ids form a clean prefix tree with the cheaper/shorter id as the registered key; LLM vendors routinely ship `-lite`/`-mini`/dated suffixes that violate that assumption, and dict iteration order makes the first matching prefix arbitrary in principle.
- **Impact**: Wrong `cost_usd` stamped on the ledger and handed to LightTrack as the cross-check value — quiet COGS drift that only shows when reconciling against the provider bill.
- **Fix sketch**: Match longest-prefix-wins (sort prefixes by length desc), or require an exact base-id match after stripping a known dated suffix. The existing `test_every_routed_default_model_is_priced` only guards *current* routes, not collisions.

## 6. Gemini safety-blocked / empty candidates are metered as a paid success with empty text

- **Severity**: Medium
- **Category**: silent-failure / metering
- **File**: `pipeline/jobfit/llm/adapters/gemini_api.py:47-54`, `pipeline/jobfit/llm/base.py:232-245`
- **Scenario**: Gemini blocks the response (safety, recitation) or returns no candidates. `resp.text` raises `ValueError`, which the adapter catches and converts to `text=""`. `_call` then returns a perfectly normal `LLMResult` with whatever `usage` Gemini reported, so `complete()` records a SUCCESS event + ledger line (cost charged on the prompt tokens). The empty text only fails later in `complete_json`, after the repair re-prompt is also wasted.
- **Root cause**: Swallowing the block into empty text erases the distinction between "model declined" and "model answered with nothing", so the failure is invisible to monitoring and indistinguishable from a transient blank.
- **Impact**: Blocked prompts are billed and counted as successful completions in the ledger/telemetry, and the operator gets no "content was blocked" signal — just a downstream parse failure and a fallback. Recurrent blocks (e.g. a prompt template that trips a filter) look like random quality dips.
- **Fix sketch**: Inspect `resp.candidates[0].finish_reason` / `prompt_feedback.block_reason`; when blocked, raise a typed `LLMError(subtype="blocked")` so it's emitted as an error event, not a success, and so `complete_json` skips the pointless repair.

## 7. Ledger writes under `map()` open/close the file per call, and a permission/disk error is fully swallowed

- **Severity**: Low
- **Category**: silent-failure / observability
- **File**: `pipeline/jobfit/llm/monitor.py:92-112`, `:108-111`
- **Scenario**: `base.map()` runs up to `max_workers` concurrent `complete()` calls; each one independently `open(path, "a")`s the ledger under `_ledger_lock`. The lock prevents interleaved lines (good), but if the ledger path is unwritable (read-only mount, disk full, bad `KP_LLM_USAGE_LOG`) every write hits the bare `except Exception: pass` and is dropped with zero signal — the durable spend record the docstring calls "the DURABLE spend record" silently has holes while LLM calls keep succeeding.
- **Root cause**: The "ledger I/O must never break the host call" guarantee is implemented as total, unconditional silence; there is no one-time warning to stderr and no in-process counter of dropped lines, so a misconfigured `KP_LLM_USAGE_LOG` produces a clean-looking run with no spend recorded.
- **Impact**: Spend reconciliation silently under-reports for an entire spawn whenever the sidecar path is wrong/unwritable — the worst case for a metering ledger is failing invisibly.
- **Fix sketch**: Keep swallowing, but log the FIRST failure per process to stderr (and/or increment a module counter surfaced by the canary `test_cli`), so an unwritable ledger is detectable without it ever breaking a call.
