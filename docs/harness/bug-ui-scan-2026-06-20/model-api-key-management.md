# Model & API Key Management — Bug Hunter scan

> Context: Configure LLM provider routing + securely store provider API keys, with a connectivity test and engine-availability preflight.
> Files reviewed: 18 of 14 (manifest 14 + 4 adjacent: require-operator, safe-url, python-runner, registry/config/monitor/test_cli/adapters)
> Total: 7 findings — Critical: 0, High: 3, Medium: 2, Low: 2

## 1. Canary error payload on the stdout (exit-0) path is returned to the client UNREDACTED — provider key can leak

- **Severity**: High
- **Category**: secret-leakage
- **File**: `app/api/llm/test/route.ts:30-39`, `pipeline/jobfit/llm/test_cli.py:54-58`
- **Scenario**: An operator clicks "Test" for a use case whose provider key is wrong/expired. `test_cli` catches the exception, builds `error: f"{type(exc).__name__}: {exc}"[:400]`, prints it as a JSON object **to stdout**, and exits **0**. The route's scrubbing only runs on the `exitCode !== 0` branch (line 37, `redactSecrets(detail)`); the exit-0 path returns `parsePythonJson(stdout)` verbatim (line 39).
- **Root cause**: The redaction guard was placed on the wrong branch. The canary's contract is "verdict is the payload, exit 0 either way," so the *failure* envelope is delivered on the exit-0 stdout path — the one branch that never gets scrubbed. Many SDK errors echo the auth header/key (e.g. an OpenAI/Azure SDK that prints the request, or `f"...{exc}"` where the exception repr embeds the key) and Azure/OpenAI keys have no `sk-`/`AIza` prefix the downstream redactor would catch even if it ran.
- **Impact**: A decrypted provider key (or fragment) is returned to whoever can hit the Test button and rendered inline in `RoutingRow`'s note, defeating the entire "secrets are write-only" contract for this feature.
- **Fix sketch**: Run the verdict object's `.error` through `redactSecrets` before returning on the success branch too, e.g. parse, then `if (typeof p.error === "string") p.error = redactSecrets(p.error)`; or redact inside `test_cli.py` before printing. Don't rely on exit code to decide whether to scrub.

## 2. One undecryptable stored key bricks ALL LLM routing (hot path), not just that provider

- **Severity**: High
- **Category**: latent-failure / availability
- **File**: `app/_lib/llm-config.ts:183-188` (`buildLlmConfigEnv`), called at `app/_lib/reasoning-run.ts:84` and `app/_lib/automation-run.ts:183`
- **Scenario**: An operator stores a BYOM key, later rotates `KP_SECRET` (or one ciphertext row gets partially corrupted / a meta_json blob desyncs). `buildLlmConfigEnv` loops **every** `provider_keys` row and eagerly calls `decryptProviderSecret(row.keyCiphertext)`. The GCM auth-tag check throws on the bad row, the throw propagates out of `buildLlmConfigEnv` — which is invoked *inline as the `env:` argument* to `spawnPython` — and aborts the whole reasoning/automation run.
- **Root cause**: All keys are decrypted up front and unconditionally, even keys for providers no use case is pinned to, and even when the resolved provider is `claude_cli` (needs no key at all). A single bad row is treated as fatal for the entire config assembly instead of being isolated to the provider that owns it.
- **Impact**: A key the operator isn't even using — or a stale key after a secret rotation — takes down match-reasoning and the automation scheduler entirely (every spawn 500s), with a stack trace instead of an actionable message. The fail-loud intent (avoid misattributed spend) is correct for the *pinned* provider but wrong as a blast radius for *all* routing.
- **Fix sketch**: Decrypt lazily/defensively per row: wrap each `decryptProviderSecret` in try/catch and omit (or mark) the row that fails, so other providers and the keyless claude_cli default still run; surface the bad provider via a one-time server log. Only fail the call when the *resolved* provider's key is the broken one.

## 3. `redactSecrets` misses keyless-prefix providers and structured leaks — best-effort scrubber overtrusted

- **Severity**: High
- **Category**: secret-leakage
- **File**: `app/_lib/redact-secrets.ts:9-16`
- **Scenario**: The patterns match `sk-ant-`, `sk-`, `AIza`, `Bearer …`, an `api[-_]?key` field, and a `KP_LLM_CONFIG=` assignment. Azure OpenAI keys are 32-char hex with **no recognizable prefix**; a custom/self-hosted key likewise. An SDK error that prints `https://host/...?api-version=...` with an `api-key: <hex>` header (Azure uses the `api-key` header, which *is* covered) but also error bodies that echo the bare key value with no `key=` context will pass straight through.
- **Root cause**: The redactor is shape-based and can only catch *known* secret shapes; an Azure/custom key is indistinguishable from benign hex. The architecture leans on this scrubber as the boundary control (per finding #1 it's the only one), but it is explicitly "best-effort."
- **Impact**: For the most common BYOM provider that *requires* an endpoint (Azure), the scrubber provides little protection, so any leak path (finding #1, or future logging) exposes the key.
- **Fix sketch**: Don't echo provider stderr/exception text to clients at all for the keys/test surface — return a fixed "authentication failed / connectivity failed" verdict plus a server-only detailed log. If text must be forwarded, additionally redact the *known plaintext key values* (the ones just decrypted into `KP_LLM_CONFIG`) by literal string replacement, which catches prefixless keys.

## 4. At-rest key derivation is bare SHA-256 of KP_SECRET — no KDF/salt, dual-use secret

- **Severity**: Medium
- **Category**: weak-crypto
- **File**: `app/_lib/llm-secret.ts:30-37`
- **Scenario**: `masterKey()` = `sha256(KP_SECRET)`. The same `KP_SECRET` also keys the session HMAC (per the comment). The weak-secret check (`MIN_SECRET_LEN = 24`) only warns, only in production, and only once.
- **Root cause**: A single fast hash (not a slow KDF like scrypt/PBKDF2/argon2 with a per-deployment salt) means a leaked DB plus a guessable/low-entropy operator secret is brute-forceable, and the dual use ties session forgery and key decryption to the same value.
- **Impact**: If `kp.sqlite` leaks (backup, snapshot, repo misconfig) and `KP_SECRET` is weak, every stored provider key is recoverable offline at high speed; rotating the secret to fix it simultaneously invalidates sessions and bricks existing ciphertexts (finding #2).
- **Fix sketch**: Derive the encryption key via `scrypt`/`hkdf` with a stored random salt and a domain-separation label distinct from the session HMAC key; keep a version tag in the ciphertext (`v2:`) so old `v1:` rows still decrypt during migration.

## 5. No length bound on stored apiKey / endpoint / apiVersion

- **Severity**: Medium
- **Category**: input-validation
- **File**: `app/api/llm/keys/route.ts:41-55`, `app/_lib/llm-config.ts:90-114`
- **Scenario**: PUT only checks `typeof apiKey === "string" && .trim()`. An operator (or anything that reaches this authenticated route) can store a multi-megabyte `apiKey`/`apiVersion`. It's encrypted and written to `provider_keys`, then decrypted and JSON-stringified into `KP_LLM_CONFIG` on *every* spawn.
- **Root cause**: Trust-boundary validation stops at "non-empty string." There is no upper bound, so the row size and the per-spawn env var are attacker-influenced.
- **Impact**: A pathological value bloats every `buildLlmConfigEnv()` result and the child-process env block (OS env-size limits can make spawns fail), and inflates the SQLite row — a low-effort self-DoS / footgun, gated only by the operator role.
- **Fix sketch**: Cap `apiKey` (e.g. ≤ 1 KB), `endpoint` (≤ 2 KB, already URL-parsed), and `apiVersion` (≤ 64 chars) with explicit 400s before `saveProviderKey`.

## 6. DELETE keys route accepts `claude_cli`, inconsistent with PUT's keyable-provider gate

- **Severity**: Low
- **Category**: validation-inconsistency
- **File**: `app/api/llm/keys/route.ts:70`
- **Scenario**: PUT rejects non-keyable providers via `isKeyableProvider` (excludes `claude_cli`). DELETE validates with `isLlmProvider`, which *accepts* `claude_cli`. A DELETE for `{provider:"claude_cli"}` returns `ok:true, removed:false`.
- **Root cause**: The two handlers derive "what is a key-bearing provider" from different predicates; only PUT uses the single-source `KEYABLE_PROVIDERS` rule.
- **Impact**: Cosmetic/no security impact (nothing is stored under `claude_cli`), but it's a contract drift that invites future bugs if a code path starts trusting the DELETE-accepted provider set.
- **Fix sketch**: Use `isKeyableProvider` in DELETE too, or factor a shared `assertKeyableProvider` used by both PUT and DELETE.

## 7. Claude-CLI availability is cached for process lifetime; reinstalling the CLI needs a restart

- **Severity**: Low
- **Category**: stale-cache
- **File**: `app/_lib/engine-preflight.ts:26-47`
- **Scenario**: `probeClaudeCli` memoizes the first PATH scan in `cachedClaudeCli` forever. If `claude` is installed *after* the server started (the common "oops, missing CLI" remediation), `engineAvailability()` keeps reporting `claudeCli:false` (and the Gemini side, read live from env, can disagree) until a full restart.
- **Root cause**: A "PATH never changes under a running server" assumption that holds in prod but not during local setup / the exact moment an operator is fixing the missing-CLI warning this preflight exists to surface.
- **Impact**: Misleading "engine unavailable" hint persists after the operator fixed it, eroding trust in the preflight; deterministic-fallback output keeps masquerading as AI output with no visible signal that it's now fixable.
- **Fix sketch**: Add a short TTL (e.g. 60 s) to the cache, or expose a tiny "re-probe" affordance / invalidate on the health route when explicitly requested.
