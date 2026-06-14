> Total: 4 findings (Crit/High/Med/Low: 0/0/2/2)

Context: **LLM Settings & Model Config** (`llm-settings-model-config`). Scope = the 8 files listed in `_scan-plan.json`: the three `app/api/llm/{config,keys,test}/route.ts` routes, the `app/features/sub_models/{ModelsTab,KeysPanel,provider-names}.tsx/ts` UI, and the shared `app/_lib/{llm-config,llm-secret}.ts`. This is a recently-added, headless-first subsystem; nothing here is genuinely dead — every export has a live caller. The two real opportunities are cross-file shape/concept duplication; the other two are cleanup.

Explicitly NOT flagged (per kp conventions): the `LLM_PROVIDERS` / `LLM_USE_CASES` catalogs in `llm-config.ts` deliberately parallel `PROVIDER_CAPABILITIES` / `USE_CASE_REQUIREMENTS` in `pipeline/jobfit/llm/capabilities.py` across the TS↔Python boundary (the module header says "Python is authoritative; these lists only gate what the admin API accepts"). That is intentional, comment-documented parallelism — not force-merged.

## 1. Provider-key metadata shape is declared twice (server return type vs. client `KeyMeta`)
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/features/sub_models/KeysPanel.tsx:18` (+ `app/_lib/llm-config.ts:79-93`)
- **Evidence**: `listProviderKeyMeta()` returns an *anonymous* `Array<{ provider: string; scope: string; endpoint?: string; apiVersion?: string; updatedAt: string }>` (llm-config.ts:79-93). `KeysPanel.tsx:18` independently declares `type KeyMeta = { provider: string; scope: string; endpoint?: string; apiVersion?: string; updatedAt: string }` — structurally identical, field-for-field. Grep `KeyMeta|listProviderKeyMeta` confirms the server type is never exported and the client never imports it; the shape is maintained in two places by hand. The route (`keys/route.ts:18`) is the only producer and `KeysPanel` the only consumer, so the two are a guaranteed contract pair.
- **Impact**: Adding/renaming a metadata field (e.g. a future `region` for Azure) silently drifts: the server can add it while the client `KeyMeta` and its `KeyMeta[]` casts at lines 87/111 keep compiling against the stale shape, dropping the field with no type error.
- **Fix sketch**: In `llm-config.ts`, name the return type — `export type ProviderKeyMeta = { provider: string; scope: string; endpoint?: string; apiVersion?: string; updatedAt: string }` and annotate `listProviderKeyMeta(): ProviderKeyMeta[]`. In `KeysPanel.tsx`, delete the local `KeyMeta` and `import type { ProviderKeyMeta } from "@/app/_lib/llm-config"`; update `KeysPayload` and the two response casts to use it. Mechanical, single source of truth.

## 2. "`claude_cli` is not a keyable provider" rule is hand-coded in three places
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/features/sub_models/KeysPanel.tsx:55` and `:121` (+ `app/api/llm/keys/route.ts:30,32`)
- **Evidence**: Grep `claude_cli` over `app/` returns four enforcement sites of the same business rule. `KeysPanel.tsx:55` (`payload.providers.filter((x) => x !== "claude_cli")[0]`) and `:121` (`data.providers.filter((p) => p !== "claude_cli")`) filter it out of the form twice; `keys/route.ts:30` rejects `body.provider === "claude_cli"` and `:32` returns `LLM_PROVIDERS.filter((p) => p !== "claude_cli")`. The literal `"claude_cli"` and the filter predicate are duplicated rather than centralized, even though `llm-config.ts` already owns `LLM_PROVIDERS` and the `isLlmProvider` guard.
- **Impact**: The "providers that take a stored key" set lives in four spots; if a second keyless provider is ever added (or `claude_cli` renamed), each site must be found and edited, and the route-vs-UI rules can silently diverge (UI offers a provider the PUT then 400s, or vice-versa).
- **Fix sketch**: Add to `llm-config.ts` next to `LLM_PROVIDERS`: `export const KEYABLE_PROVIDERS = LLM_PROVIDERS.filter((p) => p !== "claude_cli");` and `export function isKeyableProvider(v: unknown): v is LlmProvider { return isLlmProvider(v) && v !== "claude_cli"; }`. Route: replace the `:30` check with `!isKeyableProvider(body.provider)` and return `KEYABLE_PROVIDERS` at `:32`. UI: have `GET /api/llm/keys` return `KEYABLE_PROVIDERS` (line 18) so `KeysPanel` drops both client-side `.filter(... !== "claude_cli")` calls entirely. Keep one literal, in one file.

## 3. `KP_LLM_CONFIG_ENV` is `export`ed but only used inside its own module
- **Severity**: Low
- **Category**: dead-code
- **File**: `app/_lib/llm-config.ts:55` (used at `:145`)
- **Evidence**: Grep `KP_LLM_CONFIG_ENV` across the whole repo returns exactly two hits, both in `llm-config.ts` (declaration at :55, sole use at :145 inside `buildLlmConfigEnv`). No other module imports it; callers of the subsystem use `buildLlmConfigEnv()` (test/route.ts:24, automation-run.ts:161, reasoning-run.ts:67), never the constant. The `export` keyword has zero external consumers.
- **Impact**: Cosmetic — an unused public symbol widens the module's apparent API and invites a future caller to read the raw env var instead of going through `buildLlmConfigEnv()`. Not removable as "dead" code (it's used internally), only the `export` is surplus.
- **Fix sketch**: Drop the `export` (make it a module-local `const KP_LLM_CONFIG_ENV = "KP_LLM_CONFIG"`), or inline the literal at :145. Low risk; verify no test imports it (none do — only `llm-secret.test.ts` exists in this subsystem, and it imports nothing from `llm-config`).

## 4. Stale "ships in parallel / 404" comment on the Test button (route now shipped)
- **Severity**: Low
- **Category**: cleanup
- **File**: `app/features/sub_models/ModelsTab.tsx:93-94` (and the `r.status === 404` branch at :104)
- **Evidence**: The comment reads "Canary call through the real registry. The route ships in parallel with this UI — a 404 reads as 'not available yet', inline, never a crash." But `app/api/llm/test/route.ts` is present, in-scope, and live (it spawns `pipeline.jobfit.llm.test_cli`, confirmed shipped via grep `test_cli`). The route never returns 404 — it returns 200 with `{ ok:false }` on failure, or 400/500. So the comment describes a pre-ship state that no longer holds, and the `if (r.status === 404) throw new Error(t("testUnavailable"))` guard at :104 is now effectively unreachable in normal operation.
- **Impact**: Documentation rot — the comment misleads a future reader into thinking the Test feature is provisional/unwired when it is fully wired. The 404 branch is harmless defensive code, but its rationale no longer matches reality.
- **Fix sketch**: Update the comment to drop the "ships in parallel" framing (e.g. "Canary call through the real registry; verdict is the payload, errors render inline"). Optionally retire the `404 → testUnavailable` branch and its `models.routing.testUnavailable` i18n key if the team confirms the route is permanent. Comment-only edit is the safe minimum; do not touch the spawn/200-verdict logic.
