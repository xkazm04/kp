# LLM Provider Layer (Python) — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 3 High / 2 Medium / 0 Low
> Lens: 4 bug / 0 ui / 1 biz

> 🎨 UI Perfectionist: **N/A** — this is a headless, server-side Python LLM-abstraction layer (registry, adapters, monitor, bench CLI). No rendered surface, no user-facing UI. Skipped by design, as the prompt directed.
>
> Anthropic-adapter note (read, not recalled): `adapters/anthropic_api.py` uses the official `anthropic` SDK correctly — `client.messages.create(model=…, max_tokens=…, messages=[…], system=…)`, reads `usage.input_tokens/output_tokens/cache_read_input_tokens`, and the default model IDs in `capabilities.py`/`base.py` (`claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-8`) are current and valid. **No wrong/deprecated model id and no API misuse found** — so no finding is raised on that axis. The findings below are about behavior the adapter *omits* (truncation handling), not anything it does wrong.

## 1. `max_tokens` truncation is captured but never acted on → silently corrupted JSON answers
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Adapter error handling / partial output
- **Value**: impact 8/10 · effort 3/10 · risk 2/10
- **File**: `pipeline/jobfit/llm/adapters/anthropic_api.py:56-58` (and `openai_api.py:53`)
- **Scenario**: An `automation_screen` / `campaign_pack` prompt produces more JSON than `max_tokens` (default 2048; campaign packs are large). Anthropic returns `stop_reason="max_tokens"`, OpenAI `finish_reason="length"`. The adapter stores that flag in `raw` (line 57) but the control flow ignores it: it returns the truncated text as a perfectly normal `LLMResult`. `complete_json` then either fails to parse (raises `LLMError`) or — worse — `_extract_json` salvages a *partial* object and returns it as the answer.
- **Root cause**: `_call()` never inspects `stop_reason`/`finish_reason`; truncation is treated as a successful completion. The monitor (`monitor.emit_result`) is also called with `cost_usd`/usage as if the call succeeded, so a truncated answer registers as a clean success in LightTrack.
- **Impact**: Truncated outputs silently degrade to the deterministic template at the product layer (`automation._generate` swallows the parse `LLMError` into `"deterministic"`, automation.py:100), so a paid, half-finished LLM call shows as a healthy "success" in telemetry while the recruiter quietly gets the fallback — classic success-theater, and you still paid for the truncated output tokens.
- **Fix sketch**: In each adapter, after building the result, treat a `max_tokens`/`length` stop reason as a retryable/permanent `LLMError(subtype="truncated")` (or stamp `result.raw["truncated"]=True` and have `complete_json` reject it). At minimum surface it as a distinct error in `monitor.emit_error` so the bench/observability layer can see truncation rate, not silent fallbacks.

## 2. Retry classifier mis-tags a truncated/large response and HTTP 413/422 by substring → wrong retry decision
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Retry/backoff classification
- **Value**: impact 7/10 · effort 3/10 · risk 3/10
- **File**: `pipeline/jobfit/llm/base.py:97-114`
- **Scenario**: `is_transient_error` first checks numeric `code`/`status_code` against a retryable set, then falls back to a substring scan of `"{type}: {exc}".lower()` for markers like `"timeout"`, `"503"`, `"overloaded"`, `"temporarily"`. Two failure modes: (a) a *permanent* error whose message happens to contain a digit run like `"503"` or the word `"timeout"` (e.g. a validation message "field exceeded 503 chars", or "model temporarily unsupported in region") is retried 3× — wasted latency + tokens; (b) conversely a genuine transient SDK error whose class/message doesn't contain those markers and exposes no `.status_code` (some SDK wrapper exceptions) is treated as permanent and fails fast.
- **Root cause**: Substring matching on an unstructured stringified exception is inherently lossy; the bare tokens `"429","502","503","504","529"` match anywhere in the text. The structured `code`/`status_code` path is correct, but the fallback is too eager.
- **Impact**: Either burns the user's API budget retrying a doomed call (cost + 3× the backoff wall time on the 180s default timeout) or fails fast on a recoverable blip, both undermining the "multi-provider reliability" value prop. Hard to diagnose because it depends on error-message wording.
- **Fix sketch**: Prefer the structured code path; gate the substring fallback to whole-word/`\b`-bounded matches and drop the bare numeric markers (keep them only when paired with the structured code). Add adapter-specific exception-type checks (e.g. `anthropic.APIStatusError.status_code`, `openai.APIStatusError.status_code`) before the text heuristic.

## 3. No cross-provider failover despite a multi-provider abstraction — a single provider outage downgrades everything to the deterministic template
- **Lens**: 🚀 Business Visionary
- **Severity**: High
- **Category**: Reliability / multi-provider value
- **Value**: impact 8/10 · effort 6/10 · risk 4/10
- **File**: `pipeline/jobfit/llm/registry.py:28-76` (+ call sites e.g. `automation_cli.py:107-108`, `automation.py:96-101`)
- **Scenario**: The layer's whole pitch is provider-agnostic routing (Anthropic / OpenAI / Azure / Gemini / CLI). But `resolve_provider` returns exactly ONE provider per use case, and the call-site contract is the two-step `provider = resolve_provider(...)` + `if not provider.available(): provider = None`. `available()` only catches *missing key/SDK at startup*. If the configured provider is up at resolve time but then 429s/5xx's through all 3 retries mid-run, `complete` raises `LLMError`, and production (`automation._generate`) swallows it to the deterministic template. There is no "try Anthropic, then fall back to OpenAI/CLI" path anywhere.
- **Root cause**: The registry resolves a single adapter; no secondary/ordered-fallback concept exists in `LLMConfig` or `resolve_provider`. The capability matrix + key plumbing to support failover already exist — only the orchestration is missing.
- **Impact**: A provider incident silently halves product quality (every match-reasoning/screen/campaign call drops to templates) with no LLM-level resilience, even when another fully-configured provider is healthy. For a hiring-decision SaaS this is both a quality and a differentiation gap — "multi-provider" today means "pick one", not "resilient across many".
- **Fix sketch**: Add an optional ordered `fallbacks: [provider,…]` per use-case in `KP_LLM_CONFIG`; have `resolve_provider` return a thin composite that tries each in order on `LLMError`/`is_transient_error`, emitting a `provider_failover` monitor event per hop. Validate every fallback against `unsupported_caps` at resolve time so failover can't silently violate capabilities.

## 4. Adapters omit `max_completion_tokens`/`max_tokens` cost-cap awareness vs. monitor cost cross-check — Gemini & OpenAI stamp no `cost_usd`, so cost telemetry is provider-lopsided
- **Lens**: 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Monitor accuracy / cost observability
- **Value**: impact 6/10 · effort 4/10 · risk 2/10
- **File**: `pipeline/jobfit/llm/adapters/openai_api.py:47-60`, `gemini_api.py:52-61` vs. `anthropic_api.py:64`
- **Scenario**: Only the Anthropic adapter computes `cost_usd=price_usd(...)`; OpenAI, Azure, and Gemini return `LLMResult` with `cost_usd=None` (no entry for `gpt-5-mini`/`gemini-3-flash-preview` in `MTOK_PRICES` either, and they don't call `price_usd`). The bench summarizer then reports `totalCostUsd=None` for those columns (`runner.py:155,191`) and the monitor attaches no `cost_usd` metadata for them (`monitor.py:93`). A cross-provider cost comparison — the explicit purpose of `bench_cli` ("picking default models") — shows a dollar figure for Anthropic and "—" for everyone else.
- **Root cause**: `MTOK_PRICES` (base.py:39-43) only carries Claude prices, and non-Anthropic adapters never call `price_usd`. Cost is "priced server-side from LightTrack" per the monitor docstring, but the local bench harness has no such fallback, so its comparison table is apples-to-blanks.
- **Impact**: The benchmark — the tool that justifies which provider/model becomes the default — can't actually compare cost across providers; a "cheaper" provider looks free. Undercuts cost-routing as a value lever. Low blast radius (offline tooling) hence Medium.
- **Fix sketch**: Add OpenAI/Gemini (and a per-deployment Azure hook) prices to `MTOK_PRICES`, and call `price_usd(self.model, in, out)` in every adapter's `_call` (one line each), mirroring Anthropic. Where a price is genuinely unknown, render bench cost as "n/a (priced server-side)" rather than blank so the gap is explicit.

## 5. `map()` concurrency ignores provider rate limits and shares one timeout budget — batch fan-out can self-inflict 429s
- **Lens**: 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Concurrency / rate-limit handling
- **Value**: impact 5/10 · effort 4/10 · risk 4/10
- **File**: `pipeline/jobfit/llm/base.py:279-306`
- **Scenario**: `map()` fans prompts across a `ThreadPoolExecutor` (default 4 workers) and each worker calls `complete`, which independently runs the 3-attempt exponential backoff. With `max_retries=0` set on every SDK client (delegated to this layer on purpose), a burst of 4 concurrent calls that all hit a 429 each retry independently with jittered 0.5–2s backoff — there's no shared concurrency limiter, no `Retry-After` honoring, and no global token-bucket. On a low-tier API key a campaign batch can drive its own rate-limit storm, where every item retries into the same throttle and then all fall back to deterministic together.
- **Root cause**: Retry policy is per-call only; `map` has no provider-aware concurrency cap or `Retry-After` plumbing. The fixed `0.5 * 2**attempt` backoff ignores the server's suggested wait.
- **Impact**: Batch operations (bench sweeps, bulk screening) can amplify a transient throttle into a full batch fallback, wasting tokens on retries and producing all-deterministic output that still reports as healthy. Bounded by the small default worker count, hence Medium.
- **Fix sketch**: Honor `Retry-After` (read from the SDK exception's response headers when present) in the backoff sleep, and let `map`/config cap effective provider concurrency (e.g. a per-provider semaphore) so a batch can't exceed the key's tier. Surface throttle hits as a distinct monitor signal.
