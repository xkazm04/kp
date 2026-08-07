> Total: 5 findings (0c critical, 1h high, 2m medium, 2l low)

## 1. LLM use-case catalog duplicated between TS and Python with only a comment as the guard
- **Severity**: High
- **Category**: duplication
- **File**: app/_lib/llm-config.ts:22-45 (mirrors pipeline/jobfit/llm/capabilities.py:27-44)
- **Scenario**: `LLM_USE_CASES` lists 22 use cases (`match_reasoning`, `automation`, `campaign_pack`, `jd_ingest`, all the `devcase_*`, `weight_proposal`, `interview_scorecard`, `github_analysis`, `cv_analysis`, `profile_extract`, plus `"*"`). The Python `USE_CASE_REQUIREMENTS` dict (`grep -n` confirmed: capabilities.py:27-44) carries the same set. The TS comment at lines 16-18 says "Keep in sync with … capabilities.py — Python is authoritative", but `grep -rln` over `*.test.ts`/`*.py` for the catalog names found **no sync test** — nothing mechanically enforces the comment.
- **Root cause**: Two hand-maintained lists of the same domain enum in different languages, coupled only by a code comment.
- **Impact**: A use case added on the Python side (where it's authoritative) but not mirrored into `LLM_USE_CASES` makes `isLlmUseCase` reject a legitimate pin at the admin API (`config/route.ts:35`, `test/route.ts:21`), so the Models tab can't route or canary-test it. The reverse (TS has it, Python doesn't) lets an operator save a pin that fails at resolve time. The drift is silent until someone hits the missing case in production.
- **Fix sketch**: Add a node `--test` sync test that shells `python -m` (or reads the generated catalog) to assert `LLM_USE_CASES` ⊇/= the Python keys, mirroring the "two prompt systems + a sync test" pattern noted for scan types. Do NOT merge the lists into one file — they legitimately live per-runtime; just fail CI when they diverge. (No secret handling touched.)

## 2. Provider catalog quadruplicated (TS list + Python caps + two locale files), no sync guard
- **Severity**: Medium
- **Category**: duplication
- **File**: app/_lib/llm-config.ts:19; pipeline/jobfit/llm/capabilities.py:16-21/53-58; messages/en.json:3315; messages/cs.json (same block)
- **Scenario**: The five providers (`anthropic`, `openai`, `azure_openai`, `gemini`, `claude_cli`) appear in four places, confirmed by grep: `LLM_PROVIDERS` (llm-config.ts:19), Python `PROVIDER_CAPABILITIES`/`DEFAULT_MODELS` (capabilities.py), and `models.providers` in both `messages/en.json` and `messages/cs.json` (identical 5-entry blocks). `useProviderName` (provider-names.ts) already has a `t.has()`→`labelize` fallback so a missing locale key won't crash, which partially mitigates the i18n copy — but the TS↔Python pair has no such safety and no sync test.
- **Root cause**: Same enum maintained independently per runtime + per locale.
- **Impact**: Adding a provider means editing four files; miss the TS list and the admin API rejects keys/pins for it; miss Python and a saved pin fails at resolve. Lower blast radius than #1 because the list is short and rarely changes.
- **Fix sketch**: Fold into the same TS↔Python sync test as #1 (assert the provider sets match). The locale blocks are intentionally translatable and already fallback-safe — leave them, or just lint that every `LLM_PROVIDERS` id has an `en.json` key. No change to secret/key handling.

## 3. `t.has(key) ? t(key) : labelize(...)` fallback pattern repeated three times in the Models UI
- **Severity**: Medium
- **Category**: duplication
- **File**: app/features/sub_models/provider-names.ts:12-15; app/features/sub_models/ModelsTab.tsx:246-250; app/features/sub_models/KeysPanel.tsx:63-64
- **Scenario**: grep shows three near-identical "look up an i18n label, fall back to `labelize(id)`" helpers: `useProviderName` (providers), `labelFor` (use cases), and `scopeLabel` (scopes — variant: explicit ternary then `labelize`). All three import `labelize` from `@/app/_lib/format` and guard a `next-intl` namespace miss the same way.
- **Root cause**: The "safe i18n label with labelize fallback" idiom was copy-adapted per field instead of extracted once.
- **Impact**: Low correctness risk (behavior is consistent today) but maintenance drift: a change to the fallback policy (e.g. logging unknown keys in dev, per the i18n-drift-warning pattern in MEMORY) must be made in three spots. `scopeLabel` already diverges slightly (hand-rolled ternary vs `t.has`).
- **Fix sketch**: Extract a `useLabeler(namespace)` hook (or a `safeLabel(t, key, raw)` helper) in `provider-names.ts` or `format.ts` and have all three call it. Small, contained refactor; no functional change.

## 4. Two separate import statements from the same module in test/route.ts
- **Severity**: Low
- **Category**: cleanup
- **File**: app/api/llm/test/route.ts:2-3
- **Scenario**: Lines 2 and 3 both import from `@/app/_lib/llm-config` (`buildLlmConfigEnv` on line 2; `isLlmUseCase, LLM_USE_CASES` on line 3) — confirmed by reading the file head. Redundant split import.
- **Root cause**: A second import line was added during a later edit instead of extending the existing one.
- **Impact**: Cosmetic only; harmless. Some lint configs (`import/no-duplicates`) would flag it.
- **Fix sketch**: Merge into `import { buildLlmConfigEnv, isLlmUseCase, LLM_USE_CASES } from "@/app/_lib/llm-config";`.

## 5. Defensive 404 branch in the Models "Test" handler is dead in practice (self-documented)
- **Severity**: Low
- **Category**: dead-code
- **File**: app/features/sub_models/ModelsTab.tsx:95-105 (and the `testUnavailable` string it renders)
- **Scenario**: `test()` checks `if (r.status === 404) throw new Error(t("testUnavailable"))`, but its own comment (lines 93-94) states "The 404 guard below is defensive only (the route is live and returns a 200 verdict / 400 / 500 — it does not 404 in practice)." Reading `app/api/llm/test/route.ts` confirms the POST handler only returns 200 / 400 / 500 — there is no 404 path. So the branch and its `testUnavailable` i18n key are unreachable.
- **Root cause**: Belt-and-suspenders guard kept for a status the route never emits.
- **Impact**: Minor: a dead branch plus a translated string (`models.routing.testUnavailable` in en.json + cs.json) that no user can ever see, carried for maintenance. Not a bug.
- **Fix sketch**: Optional — either drop the 404 branch and its string, or keep it but downgrade the comment to acknowledge it's deliberately speculative. Low priority; the guard is cheap and the author flagged it intentionally, so leaving it is also defensible.
