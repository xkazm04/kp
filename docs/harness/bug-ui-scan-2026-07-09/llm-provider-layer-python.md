# LLM Provider Layer (Python) — bug-hunter + ui-perfectionist scan

> Context: Provider-agnostic LLM abstraction — registry + capabilities, per-provider adapters (Anthropic/OpenAI/Azure/Gemini/OpenRouter), monitoring/usage ledger, offline gate, credential gate, and a benchmarking + judge harness.
> Files reviewed: 19 of 26
> Total: 5

## 1. KP_OFFLINE no-egress guarantee is defeated by a cloud `OPENAI_BASE_URL`

- **Severity**: Critical
- **Triage note**: Promoted High -> Critical at triage: silently breaks a documented security guarantee (E-SH-4 no-egress seal) and exfiltrates candidate PII from an air-gapped install.
- **Lens**: bug-hunter
- **Category**: trust-boundary / silent-failure
- **File**: `pipeline/jobfit/llm/adapters/openai_api.py:47-53`, `pipeline/jobfit/llm/offline.py:23-26`, `pipeline/jobfit/llm/base.py:213-219`
- **Scenario**: An air-gapped self-host sets `KP_OFFLINE=1` (E-SH-4: "nothing reaches api.openai.com / generativelanguage / api.anthropic.com"). But `OPENAI_BASE_URL` is also present in the environment — left over from a prior cloud config, or pointed at a forwarding proxy. `OpenAIProvider.available()` returns `self._import_sdk()` **whenever any base_url resolves, never calling `super().available()`**, so the `is_offline()` check in `TextProvider.available()` is skipped entirely. The provider is deemed available offline and `complete()` fires a real request to whatever host the base URL names — including a cloud one.
- **Root cause**: The offline gate assumes `base_url set ⇒ self-hosted/private`. Nothing verifies the URL is non-cloud, and unlike Azure (which gates on its own `_resolved_endpoint()`), the OpenAI adapter never overrides `_allowed_offline()` — it short-circuits the offline check in `available()` instead. The Python SDK's egress is the only thing the Python-side flag can stop (the TS `offline.ts` fetch guard is a different process), so this gap is load-bearing.
- **Impact**: A documented compliance/security guarantee silently does not hold for the OpenAI adapter — a regulated/air-gapped customer believing they are egress-sealed can leak prompts (CVs, PII) to a cloud endpoint. Fails invisibly: `available()` says "yes".
- **Fix sketch**: Have `OpenAIProvider._allowed_offline()` return True only for a base_url whose host is private/loopback (or an explicit allowlist), and route `available()` through `super().available()` so the offline check always runs. Make cloud-host base URLs fail-closed under `KP_OFFLINE`.

## 2. [STILL-OPEN] Retry budget is per-attempt, so wall-clock reaches ~3× the configured timeout

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: timeout-handling / silent-failure
- **File**: `pipeline/jobfit/llm/base.py:232-274`
- **Scenario**: A use case sets `timeoutS: 120`. `complete()` computes `budget = timeout or self.timeout` once, then in the `_MAX_ATTEMPTS=3` loop hands the **full** `budget` to every `self._call(..., timeout=budget)` plus `0.5·2^n` backoff sleeps. Three transient timeouts → ~`3·120s + backoff ≈ 370s` (default 180s → ~540s+) for one logical call. Still present verbatim: no monotonic "remaining time" is derived from `first_started` (line 233) and passed down.
- **Root cause**: `budget` is treated as a per-attempt deadline, not a total deadline; `first_started` is used only for `_elapsed_ms()` telemetry, never to shrink the next attempt's timeout.
- **Impact**: The TS `spawnPython` seam enforces its own wall-clock kill; when the Python budget outruns it the child is SIGKILLed mid-call — the user sees a generic failure, `monitor.emit_result`/the ledger line for spend that DID occur is never written, and it stacks under `map()` (N workers each able to run 3× over). This is the "wakes you up" failure on a provider brown-out.
- **Fix sketch**: Before each attempt compute `remaining = budget - (monotonic() - first_started)`; break (raise `last`) when `remaining <= ~1s`; pass `int(remaining)`. Makes the configured timeout a true ceiling.

## 3. OpenRouter/OpenAI 200-with-error (empty `choices`) is metered as a paid success

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / metering
- **File**: `pipeline/jobfit/llm/adapters/openai_api.py:84-104`, `pipeline/jobfit/llm/adapters/openrouter.py:26-60`
- **Scenario**: OpenRouter's well-known idiom is to return **HTTP 200 with a body carrying a top-level `{"error": …}` and no usable `choices`** when a proxied model errors (provider outage, moderation, credit issue). The inherited `_call` does `choice = resp.choices[0] if getattr(resp, "choices", None) else None` and coerces a missing choice/content to `text=""`. The base then records a normal SUCCESS event + ledger line, stamps `cost_usd` on whatever `usage` came back, and only `complete_json` later trips on empty text — after also burning the self-repair re-prompt.
- **Root cause**: The adapter never inspects `finish_reason` or a top-level `error`; it equates "no content" with "the model answered with empty prose". Same class the prior scan flagged for Gemini (#6), but here in the newly-added OpenRouter path where 200-with-error is routine, not exceptional.
- **Impact**: Provider-side errors on the many-models matrix are billed and counted as healthy completions; the operator sees a downstream parse failure + fallback instead of a "provider error" signal, so a flaky OpenRouter model reads as random quality dips rather than an error.
- **Fix sketch**: In `_call`, if `choices` is empty, a top-level `error` is present, or `finish_reason` is `error`/`content_filter`, raise a typed `LLMError(subtype=...)` so it emits as an error and `complete_json` skips the pointless repair.

## 4. `bake_quality` silently drops a fully-judged model's whole column on a single missing dimension

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / data-loss
- **File**: `pipeline/jobfit/llm/bench/bake_quality.py:55-83`, `pipeline/jobfit/llm/bench/judge.py:99-111`
- **Scenario**: `judge.py` stores `judge_detail` dims with a bare `payload.get("relevance")` — no coercion. If the Claude judge formats a dimension non-numerically (`"8/10"`, `"high"`) or omits it, that key is `None`/str for those rows. In `_cell`, `_med_dim` filters to `(int, float)` and returns `None` when a model×op has no numeric value for a dim; `_cell` then hits `if any(v is None for v in dims.values()): return None` and drops the cell **even though `judge_score` (overall) parsed fine and the model genuinely ran and was judged**.
- **Root cause**: A per-dimension formatting slip is treated as "this model produced no comparable output". Overall score and per-dimension scores are validated independently, and the strict all-or-nothing `_cell` gate lets one soft field void a real measurement.
- **Impact**: `bake_quality` writes the generated `app/_lib/llm-quality-scores.ts` that the Models tab renders to help users pick a provider. A dropped column makes a real, working, judged model look like it produced nothing — a misleading model-selection scorecard, committed as generated data.
- **Fix sketch**: Coerce dims defensively in `judge.py` (`float(...)` in a try, else `None`), and in `_cell` keep the cell on `judge_score` alone, emitting per-dim medians only when present rather than voiding the whole cell.

## 5. Credential expiry flags a *valid* licence as expired when the string carries two years

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / validation-gap
- **File**: `pipeline/jobfit/credentials.py:54-70` (`_parse_past`, `_YEAR_RE` at :50)
- **Scenario**: A regulated credential's `expiry` string holds both an issue and an expiry year, e.g. `"Issued 2020, expires 2028"`. `_YEAR_RE.search()` returns the **first** match (2020); `_parse_past` sees `2020 < today.year` and returns True, so `credential_checks` appends a `Credential: '…' carries a date (…) that appears to be in the past` line for a licence that is actually current until 2028. (Symmetrically, `expiry[:ym.start()] + expiry[ym.end():]` can surface a stray day/issue number as a "month" in the same-year branch, producing a false past flag.)
- **Root cause**: `search()` grabs the earliest year, not the latest/expiry year; the function's own docstring acknowledges the field is ambiguous (may be an issue date) but the first-match logic makes the two-year case worse, directly contradicting the module's stated goal of keeping false positives to "a recruiter's glance".
- **Impact**: A false "licence expired" sentence is folded into the sanity-check trust ledger for a compliant candidate in a hard-gate role (RN, CPA, Series 7, PE…). It is advisory ("manual review"), but a misleading expiry flag can bias a screening/reject decision on exactly the roles where the gate is legally consequential.
- **Fix sketch**: Take the **max** matched year (or parse a real date and compare), and require a full parseable date before flagging expiry; when only one ambiguous year is present, keep the conservative "don't flag" behavior the docstring promises.
