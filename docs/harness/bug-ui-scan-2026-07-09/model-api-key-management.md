# Model & API Key Management — bug-hunter + ui-perfectionist scan

> Context: Configure LLM provider routing, store BYOM/provider API keys (write-only, encrypted at rest), test connectivity, and surface a measured quality matrix + a usage/cost ledger.
> Files reviewed: 21 of 23
> Total: 5

## 1. [STILL-OPEN] Canary "Test" returns provider-SDK error text to the client UNREDACTED on the exit-0 path

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: secret-leakage
- **File**: `app/api/llm/test/route.ts:30-38`, `pipeline/jobfit/llm/test_cli.py:54-59`
- **Scenario**: An operator clicks "Test" for a use case whose stored key is wrong/expired. `test_cli.py` catches the provider exception, builds `error: f"{type(exc).__name__}: {exc}"[:400]`, prints that verdict object to **stdout**, and returns **0**. The route redacts only on the `exitCode !== 0` branch (line 36, `redactSecrets`); the exit-0 branch returns `parsePythonJson(stdout)` verbatim (line 38), and `RoutingRow.test` renders `p.error` inline.
- **Root cause**: The canary's contract is "verdict is the payload, exit 0 either way," so the *failure* envelope always arrives on the one branch that is never scrubbed. `redactSecrets` is also shape-based (`sk-`/`AIza`/`Bearer`) and misses prefixless keys (Azure/custom), so it under-protects even where it runs.
- **Impact**: Any provider SDK/transport error that echoes the request URL or `Authorization` header (httpx connection dumps, misconfigured OpenAI-compatible endpoints) returns key material to whoever can press Test — defeating the write-only-secrets contract. Rises to **Critical** if a real key byte leaks.
- **Fix sketch**: Redact the parsed verdict's `.error` before returning on the success branch too (`p.error = redactSecrets(p.error)`), or scrub inside `test_cli.py`; never let exit code decide whether to scrub. Prefer returning a fixed "authentication/connectivity failed" verdict + a server-only log.

## 2. Stale Azure endpoint bleeds onto a non-Azure key because the hidden field keeps its state

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: `app/features/sub_models/KeysPanel.tsx:68-100`, `app/_lib/llm-config.ts:91-108,203-207`
- **Scenario**: Operator selects `azure_openai`, types an endpoint, then switches the provider `Select` to `openai`. The endpoint input is hidden (`isAzure` false) but `endpoint` state is retained. On save, `save()` still spreads `...(endpoint.trim() ? { endpoint } : {})`, POSTing the leftover Azure URL for the OpenAI key.
- **Root cause**: `saveProviderKey` only runs the `*.openai.azure.com` host constraint `if (input.provider === "azure_openai")`; for any other provider the generic `assertPublicHttpsEndpoint` passes the (valid, public, https) Azure URL and stores it. `buildLlmConfigEnv` then forwards `meta.endpoint` to whatever provider owns the row, so the OpenAI adapter receives an endpoint override it never should have.
- **Impact**: Wrong metadata persisted and rendered on the key row; a spurious endpoint override handed to the OpenAI adapter (potential misroute of the customer's traffic). Not an SSRF (the guard still runs) but a real data-integrity/routing defect from client state leakage.
- **Fix sketch**: Clear `endpoint`/`apiVersion` when the provider changes away from Azure (or only include them in the body when `isAzure`); server-side, ignore/reject `endpoint` for providers that don't take one.

## 3. Usage panel silently under-reports cost — Azure and unknown-model spend sums to $0

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/_lib/db/llm.ts:178-206`, `pipeline/jobfit/llm/base.py:50-61`, `app/features/sub_models/UsagePanel.tsx:85-98,155-164`
- **Scenario**: An operator runs BYOM traffic on Azure (or any model not prefix-matched in `MTOK_PRICES`). Each ledger row is written with `cost_usd = NULL` (Azure is intentionally unpriced; the other non-Anthropic prices are self-described "LOCAL ESTIMATES"). `aggregateLlmUsage` does `COALESCE(SUM(cost_usd), 0)`, and `UsagePanel` renders the cost column + Total as `$0.00` even though real tokens were spent.
- **Root cause**: The cost column presents an authoritative-looking dollar figure while NULL-cost rows are folded to 0 with no "unpriced" signal. The panel can't distinguish "cost $0" from "cost unknown."
- **Impact**: Budget/spend decisions made off the Models → Usage panel undercount the exact providers most likely to be BYOM (Azure/custom). LightTrack is the true source of truth, but this in-app surface misleads.
- **Fix sketch**: Track a priced-vs-unpriced split (e.g. `SUM(cost_usd IS NULL)` count) and render "N calls unpriced — see LightTrack" instead of `$0.00`; or omit the cost cell when every row for that use case is NULL.

## 4. Saving a key that already exists silently overwrites it with no confirmation

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/features/sub_models/KeysPanel.tsx:68-100`, `app/_lib/db/llm.ts:79-94`
- **Scenario**: A key already exists for (e.g.) `openai` / `byom`. The operator re-selects `openai`/`byom` to add another and submits (or fat-fingers a new value). `upsertProviderKey`'s `ON CONFLICT (provider, scope) DO UPDATE` replaces the working secret; the form gives no hint a key exists for that pair and no "replace existing key?" guard.
- **Root cause**: The add form treats create and destructive-replace identically. The existing-keys list above the form isn't cross-referenced against the selected provider/scope, so the destructive nature is invisible until after the overwrite.
- **Impact**: A single mistyped save silently destroys a live production BYOM credential (encrypted, unrecoverable) with no undo and no warning — a real "wakes you up at night" footgun on a money-bearing surface.
- **Fix sketch**: When the selected provider+scope matches an existing row, relabel the button "Replace key" and require a confirm; or show an inline "a key already exists for this provider/scope" notice next to the submit control.

## 5. Deterministic-fallback serves are counted as "calls" in the usage panel

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: visual-consistency
- **File**: `pipeline/jobfit/llm/monitor.py:123-142`, `app/_lib/db/llm.ts:178-206`, `app/features/sub_models/UsagePanel.tsx:34-53`
- **Scenario**: `emit_deterministic` writes ledger rows with `provider="deterministic"`, zero tokens/cost, when a template fallback served instead of an LLM. `aggregateLlmUsage` groups by provider, but `foldByUseCase` sums `calls` across *all* providers, so a use case's headline "calls" count blends real paid LLM calls with template fallbacks that never hit a provider.
- **Root cause**: The panel collapses the provider dimension for the "calls" metric, discarding the one signal that distinguishes a real LLM call from a keyless/fallback serve.
- **Impact**: "match_reasoning: 50 calls" reads as 50 LLM invocations when some fraction were deterministic fallbacks — a subtly misleading reliability/spend indicator, especially when an engine is misconfigured and everything silently falls back.
- **Fix sketch**: Show LLM vs deterministic as separate counts (or a "% LLM" reliability chip) per use case, reusing the `source`/`provider="deterministic"` distinction the ledger already records.
