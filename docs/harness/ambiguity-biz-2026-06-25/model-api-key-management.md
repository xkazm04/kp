# Model & API Key Management — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C0/H2/M3/L0

## 1. Cost/usage visibility is built but never surfaced at the decision point
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / value-left-on-table
- **File**: app/_lib/db/llm.ts:178
- **Observation**: `aggregateLlmUsage()` — a full per-day × use-case × provider × model rollup of tokens AND `cost_usd` — is implemented and tested, but has **zero callers** anywhere in `app/` (no `/api/llm/usage` route, no panel). `docs/LLM_PROVIDER_LAYER.md:92,229,232` explicitly promise a "usage panel" in the Models admin and a Test button that "shows latency + tokens + cost", yet `ModelsTab.tsx` renders only routing rows + `KeysPanel`, and the canary path drops usage entirely: `test_cli.py:50-53` emits `latencyMs` but no `usage` (its own docstring at line 8-9 claims it returns `usage`), and `app/api/llm/test/route.ts:39` forwards none of it. The operator is asked to pick a model per use case (`ModelsTab.tsx:142-165`) with no in-product answer to "what does each option cost me?".
- **Why it matters**: Spend attribution is the entire point of the BYOM/platform pricing tier (`LLM_PROVIDER_LAYER.md:69,255-256`). The ledger is being written on every call but the margin/cost story is invisible — operators can't see runaway spend, justify a cheaper model, or bill BYOM vs platform differently. Revenue and trust are left on the table while the data already exists.
- **Recommendation**: Add a thin `GET /api/llm/usage` (operator-gated) over `aggregateLlmUsage()` and a usage panel in `ModelsTab` (per use-case cost/tokens, 30-day). Also pass `usage`/`cost` through `test_cli.py` → `test/route.ts` → the Test note so each canary shows cost, matching the documented contract.
- **Effort**: M

## 2. Rotating KP_SECRET silently bricks every stored key and the whole LLM layer — no rotation path
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: hidden trade-off / ops runbook gap
- **File**: app/_lib/llm-secret.ts:10
- **Observation**: One `KP_SECRET` keys BOTH at-rest provider-key encryption (`llm-secret.ts:30-37`) and the session HMAC. If it changes, stored keys become undecryptable — and `buildLlmConfigEnv()` is documented to **fail loud** on an undecryptable key (`llm-config.ts:166-170,184`), meaning a single stale row throws and breaks the env build for **all** LLM spawns (the `/api/llm/test` canary at `test/route.ts:28`, and any production task that calls `buildLlmConfigEnv()`), not just the one provider. There is no re-encrypt/rotation tool and no documented recovery beyond manually re-entering every key; the one-time weak-secret warning (`llm-secret.ts:19-28`) is the only operator guidance.
- **Why it matters**: Secret rotation is routine security hygiene, but here it's an undocumented landmine that can take the entire hiring pipeline offline with a loud-but-opaque failure. The reasoning for "fail loud over fall back" is recorded; the *consequence* and the *fix* are tribal knowledge.
- **Recommendation**: Add a rotation runbook + a small CLI/endpoint that, given old+new secret, decrypts and re-encrypts all `provider_keys` rows in one transaction. At minimum, document the data-loss trade-off in `LLM_PROVIDER_LAYER.md` and make a single undecryptable row skip-with-warning rather than abort the whole env build.
- **Effort**: M

## 3. No model catalog or validation at save — model ids are free-text tribal knowledge
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: unvalidated input / undocumented assumption
- **File**: app/features/sub_models/ModelsTab.tsx:157
- **Observation**: The model field is a bare free-text `<input>`; the config PUT accepts **any** non-empty string (`app/api/llm/config/route.ts:41`) with no membership or capability check. The real model catalog and per-use-case overrides live only on the Python side (`capabilities.py:53-67` `DEFAULT_MODELS`/`USE_CASE_MODEL_OVERRIDES`) and are never sent to the UI. So an operator must already know that anthropic wants `claude-haiku-4-5` and that `cv_analysis` requires `file_input` (`capabilities.py:47`); a typo or an incompatible provider pin saves cleanly, shows a green "Pinned" badge, and only fails later at resolve time — or, per `engine-preflight.ts:6-9`, silently degrades to deterministic fallback for text use cases.
- **Why it matters**: The core promise of this screen is "configure which models power the app," yet it offers no guardrails for the exact mistakes that produce silently wrong hiring output. Knowledge that should be a dropdown is locked in a Python dict.
- **Recommendation**: Expose the catalog (default models + capability matrix) via the existing `/api/llm/config` GET payload and render a model dropdown (with free-text escape hatch). Pre-validate provider↔use-case capability fit at save and warn inline before persisting.
- **Effort**: M

## 4. Saving a key reports success without ever testing it
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: onboarding friction / happy-path-only
- **File**: app/features/sub_models/KeysPanel.tsx:66
- **Observation**: `save()` stores the key and shows "Saved" on a 200 (`KeysPanel.tsx:88-91`) with **no connectivity check** — the PUT only validates shape/SSRF, never that the key authenticates (`app/api/llm/keys/route.ts:49-63`). The working canary (`/api/llm/test`) lives only in the *routing* table and only appears after a pin exists and for non-`*` use cases (`ModelsTab.tsx:186`). An operator can paste an expired/typo'd/wrong-scope key, see green, and discover the breakage only when a real candidate's CV analysis fails in production.
- **Why it matters**: First-run key setup is the make-or-break onboarding moment for a BYOM tier; a false "Saved" erodes trust in the most security-sensitive screen and generates support load. The verification machinery already exists — it's just not wired to the save.
- **Recommendation**: After a successful key save, offer/auto-run a one-click "Verify connection" (reuse the canary against a cheap use case for that provider) and show a pass/fail with redacted error, so the key panel itself confirms the key works.
- **Effort**: S

## 5. The provider/model benchmark + LLM-judge is a CLI-only dark capability
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: dark capability / differentiation
- **File**: pipeline/jobfit/llm/bench/bench_cli.py:1
- **Observation**: A complete benchmark harness drives the **real** production functions across `provider[:model]` targets and reports validity, p50/p95 latency, tokens and **total cost** per use case (`bench_cli.py:1-13`, `LLM_PROVIDER_LAYER.md:41-60`), with optional LightTrack LLM-as-judge quality scoring. It is deliberately CLI-only ("never from CI", spends real tokens) and is referenced nowhere in `app/`. The Models tab forces the exact decision this tool answers — "which model should I pin for this use case?" — but gives only a single yes/no canary.
- **Why it matters**: Evidence-based model selection (cost ÷ quality per use case) is a genuine competitive differentiator for a hiring product where output quality maps to hiring decisions. Leaving it in `tmp/bench` markdown means operators pin on vibes, the opposite of the harness's stated goal.
- **Recommendation**: Surface a gated, opt-in "Model Lab" — a small operator endpoint that runs a bounded bench (few scenarios, explicit token-budget confirm) for a use case and renders the cost/latency/validity comparison table inline, with a "pin this winner" action.
- **Effort**: L
