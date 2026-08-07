# Model & API Key Management — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 4 medium, 0 low)

## 1. A rotated/removed KP_SECRET fails every keyed LLM call with an un-actionable crypto error

- **Severity**: High
- **Lens**: ambiguity
- **Category**: secret-rotation-diagnostics
- **File**: `app/_lib/llm-secret.ts:48`
- **Scenario**: An operator regenerates or changes `KP_SECRET` (or restores a DB whose `provider_keys` rows were encrypted under a different secret). Every subsequent spawn calls `buildLlmConfigEnv()`, which calls `decryptProviderSecret()` on each stored row; GCM auth-tag verification fails and Node throws `Error: Unsupported state or unable to authenticate data`. That error propagates out of `buildLlmConfigEnv` and breaks every keyed LLM feature, and the Models "Test" panel returns it as an opaque 500.
- **Root cause**: The module is explicitly designed to "fail loud" on a changed secret (comments at lines 10-16 and 30-37), but the only KP_SECRET-aware messaging is the *encrypt-time* refusal string ("KP_SECRET is not set…"). The Keys panel keys its remediation hint on `text.includes("KP_SECRET")` (`KeysPanel.tsx:94`), and the decrypt-time failure message contains no such substring, so nothing maps the failure back to the master secret.
- **Impact**: The single most likely operational failure of this subsystem surfaces as a generic crypto error with zero guidance; the operator cannot tell that KP_SECRET is the cause, and every LLM-backed flow is down until they guess.
- **Fix sketch**: Wrap the `decipher.final()`/decrypt path in `decryptProviderSecret` and rethrow with an actionable message that names KP_SECRET (e.g. "Stored provider key could not be decrypted — KP_SECRET may have changed since it was saved; re-enter the key or restore the original secret."). Because `KeysPanel.tsx:94` and the test-route scrub already special-case the "KP_SECRET" token, the existing hint UI then lights up automatically.

## 2. Engine preflight reports Gemini "not configured" when the key lives in the DB, not env

- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: availability-signal-drift
- **File**: `app/_lib/engine-preflight.ts:51`
- **Scenario**: An operator stores a Gemini API key through the Models → Keys panel (a `provider_keys` row, `byom`/`platform` scope) instead of setting an env var. `resolveProviderKey("gemini", …)` (`llm-config.ts:160`) resolves that stored row *before* any env var, so the TS-direct Gemini path is fully configured — but `engineAvailability().gemini` is `Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)`, which only inspects env and returns `false`.
- **Root cause**: The preflight predates (or was never reconciled with) the DB-backed key store this context added. It encodes the old "keys only come from env" assumption, while the rest of the context treats a stored row as the highest-precedence source.
- **Impact**: `/api/health` and `/api/ops` (and the `useEngineAvailability` hint) show a false "Gemini not configured" warning for UI-configured keys — directly contradicting the DATA4 rationale that this preflight exists to warn operators before "a task fails minutes later." The one signal meant to prevent silent-fallback surprises is itself wrong for the officially-supported key path.
- **Fix sketch**: Make `engineAvailability().gemini` consult the same resolution the runtime uses — e.g. call a lightweight `resolveProviderKey("gemini", ["GEMINI_API_KEY","GOOGLE_API_KEY"])` (guarded so a decrypt error degrades to `false` rather than throwing on a health probe), or OR the env check with `listProviderKeys().some(r => r.provider === "gemini")`. Keep it server-only.

## 3. The "★ best model" routing hint hides confidence and reliability the scorecard below it shows

- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: unqualified-recommendation
- **File**: `app/features/sub_models/ModelsTab.tsx:60`
- **Scenario**: In each routing row the operator sees a green "★ <model> <score>" hint (lines 146-153) and pins that model. For a use case fed by a single bench op (e.g. `campaign_pack`, `jd_ingest`, `group_compare`), `bestModelForUseCase` (`llm-quality.ts:130`) averages composites over exactly one cell — and several such cells were measured from a single scenario with a 50% failure rate (e.g. `campaign_pack → deepseek`, `judges: 1`, `llmRate: 0.5`). The star still recommends it, in confident green, with no caveat.
- **Root cause**: `bestModelForUseCase`/`bestModelForOp` rank purely on the composite and never read the cell's `judges` (sample size) or `llmRate` (reliability), even though `QualityOverview` right below renders a `⚠ <rate>` marker for exactly those low-reliability cells.
- **Impact**: The operator is steered toward a model whose recommendation rests on one half-failing sample, with the confidence/reliability caveat visible everywhere except the one place they act on it — inconsistent, and a likely bad pin.
- **Fix sketch**: Surface a reliability/confidence caveat on the star hint: dim or `⚠`-annotate the rec when the underlying cells' mean `llmRate < LOW_RELIABILITY` or `judges` is below a small floor (reuse the `LOW_RELIABILITY = 0.9` threshold and the `⚠` treatment already in `QualityOverview.tsx`), or have `bestModelForUseCase` return the backing reliability so the row can render it.

## 4. The star hint strips the provider prefix, so the operator can't tell which provider to select

- **Severity**: Medium
- **Lens**: ui
- **Category**: recommendation-not-actionable
- **File**: `app/features/sub_models/ModelsTab.tsx:151`
- **Scenario**: The recommendation renders `shortModel(rec.model)`, and `shortModel` (line 20) drops everything before the last `/`. So `google/gemini-3.5-flash` displays as `gemini-3.5-flash` and `openai/gpt-5.4-mini` as `gpt-5.4-mini`, with no provider shown anywhere on the hint. To apply the rec the operator must (a) know that `gemini-3.5-flash` means Provider = "Gemini" and (b) type the correct bare model string into the Model field.
- **Root cause**: The measured slug is provider-qualified (`matrixSlug`), but the hint shows only the tail for compactness and never renders the provider dimension, so the actionable half of the recommendation is discarded on screen.
- **Impact**: A recommendation the whole scorecard exists to produce is only half-usable at the point of action; the operator has to reverse-map a bare model name to a provider, and can pick the wrong provider Select value.
- **Fix sketch**: Render the provider alongside the model in the hint — e.g. `★ {providerName(providerOf(rec.model))} · {shortModel(rec.model)} {score}` — deriving the provider from the slug prefix (reuse the `PROVIDER_PREFIX` map inverted) so the hint names both fields the row needs. Optionally make the hint a one-click "apply" that sets both Selects.

## 5. Silent, display-order-dependent tie-break makes the "wins" column non-deterministic

- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-tiebreak
- **File**: `app/_lib/llm-quality.ts:122`
- **Scenario**: `bestModelForOp` keeps a model only when `c > best.composite` (strict). When two models tie on composite for an op, the first one encountered in `scores.models` order keeps the "win" and the equally-good model gets none. `modelOverall` counts these into `wins`, which `QualityOverview.tsx:109` presents as an objective "wins/totalOps" figure.
- **Root cause**: The tie-break is implicit in iteration order (the baked `models[]` display order) with no documented rule, and composites are rounded to one decimal (`clamp10`), which makes exact ties common rather than rare.
- **Impact**: A model can show fewer "wins" than an identically-scoring peer purely because of its position in the baked array; re-baking with a different model order silently changes the leaderboard's win counts, so an operator comparing models on "wins" is reading an artifact of ordering, not evidence.
- **Fix sketch**: Make ties explicit — either credit a win to every model within an epsilon of the top composite (co-winners), or add a deterministic, documented secondary key (e.g. faster `p50Ms`, then higher `llmRate`) so the count is stable and defensible. Note the chosen rule near `bestModelForOp`.
