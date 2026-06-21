# Model & API Key Management — Tri-Lens Scan
> Total: 5
> Severity: 2 Critical / 2 High / 1 Low
> Lens: 3 bug / 1 ui / 1 biz

## 1. Provider-key & model-routing API routes have no authentication
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Missing auth / secret write surface
- **Value**: impact 10/10 · effort 4/10 · risk 3/10
- **File**: `app/api/llm/keys/route.ts:17`, `app/api/llm/config/route.ts:14`, `app/api/llm/test/route.ts:15`
- **Scenario**: There is no `middleware.ts` at the app root and none of the three handlers call any session/auth primitive (grep for `getServerSession|auth()|cookies()|session` in `app/api/llm` returns nothing). Anyone who can reach the server can `PUT /api/llm/keys` to overwrite the operator's provider keys, `PUT /api/llm/config` to repoint every use case at an attacker-chosen provider/endpoint, `DELETE` either, and `POST /api/llm/test` to spend the operator's tokens on demand.
- **Root cause**: Routes are "headless-first" admin endpoints but were never gated; `ModelsTab` is also mounted unconditionally in `Workspace.tsx:230` with no role check, so the gap is end-to-end.
- **Impact**: Full takeover of the LLM layer: silent key replacement (BYOM beats platform in `buildLlmConfigEnv`, so a planted byom key captures all traffic + spend), denial of service by deleting pins/keys, and uncapped cost via the canary route.
- **Fix sketch**: Add a server-side auth check (shared `requireOperator()` helper) at the top of every handler in the three routes; gate the `models` nav item / `ModelsTab` on the same role. Return 401/403 before touching the DB or spawning Python.

## 2. Azure `endpoint` is an unvalidated user URL fed to the client → SSRF + key exfil
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: SSRF / secret exfiltration
- **Value**: impact 9/10 · effort 3/10 · risk 3/10
- **File**: `app/api/llm/keys/route.ts:40`, `app/_lib/llm-config.ts:78`, `pipeline/jobfit/llm/adapters/azure_openai.py:57`
- **Scenario**: The PUT only checks that an Azure endpoint is a non-empty string (`route.ts:41-43`); it is stored verbatim in `meta_json` and later passed straight to `openai.AzureOpenAI(azure_endpoint=…)` (`azure_openai.py:55-61`) along with the api key. Save a key with `endpoint=http://169.254.169.254/…` (or `http://attacker.tld`) for `azure_openai`, pin a use case to it, then hit `POST /api/llm/test` — the server makes an authenticated outbound request, sending the bearer key to the attacker's host and/or reaching internal metadata services.
- **Root cause**: No allowlist/scheme/host validation on `endpoint`; combined with finding #1 the attacker doesn't even need an account.
- **Impact**: Cloud-metadata/internal-network SSRF and direct exfiltration of any key the operator stores for that provider.
- **Fix sketch**: Validate `endpoint` server-side — require `https:`, reject IP-literals/link-local/private ranges, and constrain Azure to the `*.openai.azure.com` suffix (or a configured allowlist). Reject at PUT time, not at call time.

## 3. KP_SECRET accepted with no strength floor — weak master key silently used
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Crypto / weak key material
- **Value**: impact 6/10 · effort 2/10 · risk 2/10
- **File**: `app/_lib/llm-secret.ts:10`
- **Scenario**: `masterKey()` accepts any non-blank `KP_SECRET` and runs it through a single unsalted `sha256`. An operator sets `KP_SECRET=test` (or copies the value from a sample), and every stored provider key is now encrypted under a trivially brute-forceable 32-byte key derived from a low-entropy string. The "encrypted at rest" guarantee the whole module advertises is hollow.
- **Root cause**: No minimum length/entropy check and no KDF stretching (no salt, no PBKDF2/scrypt) — `sha256(secret)` is one cheap hash from the password.
- **Impact**: If the SQLite file leaks, weak secrets fall to an offline dictionary attack, recovering all BYOM/platform keys; false sense of security undermines the at-rest claim.
- **Fix sketch**: Enforce a minimum length (e.g. reject < 24 chars) in `masterKey()` with a clear error, and derive the key via `scrypt`/`pbkdf2` with a fixed app salt (or stored random salt) instead of a bare hash. Add a test for the length guard.

## 4. `/test` error path can echo the provider key from Python stderr/traceback
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Secret leakage via error message
- **Value**: impact 6/10 · effort 3/10 · risk 4/10
- **File**: `app/api/llm/test/route.ts:28`, `app/_lib/llm-config.ts:155`
- **Scenario**: The decrypted key travels to Python via `KP_LLM_CONFIG` env (`llm-config.ts:142-162`). When the Python process exits non-zero, the route returns `stderr.trim().slice(-300)` verbatim to the client (`test/route.ts:28`). A stack trace, an SDK error that echoes the masked/partial key or the request URL, or any logging of `KP_LLM_CONFIG` would surface that tail to the browser — and with finding #1, to anyone.
- **Root cause**: Raw stderr is forwarded as the user-facing error with no scrubbing; the secret is in scope in the same process tree.
- **Impact**: Partial or full key disclosure, plus internal path/stack disclosure, through a button any unauthenticated caller can press.
- **Fix sketch**: Return a generic "canary failed (exit N)" to the client and log the detailed stderr server-side only; before forwarding any LLM-layer error, redact substrings matching configured key prefixes (`sk-`, `sk-ant-`, etc.) and never echo `KP_LLM_CONFIG`.

## 5. Engine preflight reports Gemini "available" from env only, ignoring stored BYOM keys
- **Lens**: 🚀 Business Visionary
- **Severity**: Low
- **Category**: Preflight false negative / BYOM trust
- **Value**: impact 4/10 · effort 4/10 · risk 2/10
- **File**: `app/_lib/engine-preflight.ts:51`
- **Scenario**: `engineAvailability().gemini` checks only `GEMINI_API_KEY`/`GOOGLE_API_KEY` env vars. An operator who configured Gemini purely through the UI keys panel (a stored `provider_keys` row — the headline BYOM path) still sees the "no Gemini key" hint and may believe analyze tasks will fail, even though the resolution path (`buildLlmConfigEnv`) will use the stored key fine. The preflight and the real resolver disagree.
- **Root cause**: Preflight predates / doesn't consult the `provider_keys` store; it duplicates a narrower availability rule than `buildLlmConfigEnv`/the Python registry actually apply.
- **Impact**: Undermines BYOM trust — the value prop is "bring your own key in the UI," yet the readiness signal pretends that didn't happen, causing needless alarm and support load.
- **Fix sketch**: In `engineAvailability()`, treat Gemini as available if env is set OR a `gemini` row exists in `listProviderKeys()` (mirror the resolver's precedence). Keep it server-only and cache as today.
