---
id: _plumbing
type: tiger/call-site
modality: meta
file: pipeline/jobfit/llm/base.py
wrapper: self (the chokepoint)
provider: all  model: all
schema: complete_json 'JSON only' guard + _extract_json (base.py:266-272); NO strict json_schema mode (the doc's LLMRequest.json_schema field was never built)
grounding: n/a
quality_score: "—"  code_score: 3
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: []
---
## What it does
`TextProvider` (base.py:117-307) is the shared chokepoint every metered Python call site flows through. Subclasses implement `_call()`; the base owns bounded retry+backoff+jitter (212-247), the complete_json guard + _extract_json repair (252-277), concurrent map() (279-306), cost stamping via price_usd/MTOK_PRICES (39-50), usage normalization, and one LightTrack emit per call (220-227). Local-dev default routes through MonitoredClaudeCli (monitor.py:123-156). resolve_provider(use_case) (registry.py:28-76) reads KP_LLM_CONFIG, validates capability routing, and returns the CLI provider unchanged with no config (zero dev drift).

## Code quality (wrapping · logging · caching)
The wrapper itself is genuinely well-built: retry single-sourced (every adapter sets max_retries=0 so the base owns backoff), duck-typed LLMResult/ClaudeResult lets call sites swap engines with no diff, telemetry double-gated + exception-swallowed (an observability outage can't break a call), misconfig fails loud while runtime degradation falls back silently. **But the two things that multiply across all sites — cost accounting and the usage ledger — are broken/absent, and the wrapper does no self-repair re-prompt and no caching.**

## Findings (all CROSS-CUTTING — they multiply across every site)
1. [code] **CRITICAL — the usage ledger does NOT exist; ~100% of LLM traffic is unmetered.** The doc claims insertLlmUsage exists; it was **deleted** in the 2026-06-14 refactor (FIXES-WAVE-1.md:15: "db/llm.ts (−31: insertLlmUsage), db/core.ts (−20: llm_usage table+indexes) — 0 writers AND 0 readers"). Confirmed live: repo-wide grep for `insertLlmUsage|llm_usage` over .ts/.tsx/.py returns ZERO code hits (docs only). The only durable telemetry is LightTrack — a sibling repo double-gated on LIGHTTRACK_URL. With no LightTrack (the default), every completion emits AND writes nothing — cost/usage evaporate. Since the doc says the pricing meters bill against llm_usage, the meters have 0% of traffic to bill against. Fix: re-add insertLlmUsage + the llm_usage table; emit one row per envelope from complete() (beside base.py:228) and MonitoredClaudeCli.complete (monitor.py:148). **The single highest-impact finding.**
2. [code] **HIGH — cost stamping missing for 3 of 4 metered adapters** → every OpenAI/Azure/Gemini call carries cost_usd=None. Only AnthropicProvider calls price_usd (anthropic_api.py:64). OpenAI/Azure/Gemini build LLMResult without cost_usd (openai_api.py:47-60, gemini_api.py:52-61). Any use case routed to those (e.g. github_analysis/cv_analysis default to gemini) silently escapes cost accounting; the bench shows cost = — for those columns. Fix: add cost_usd=price_usd(...) to the three adapters.
3. [code] **HIGH — MTOK_PRICES is missing every non-Anthropic model the catalog routes to** (base.py:39-43 lists only 3 Claude models). DEFAULT_MODELS routes openai→gpt-5-mini, gemini→gemini-3-flash-preview; price_usd returns None for both even after Finding 2. Fix: add gpt-5-mini, gemini-3-flash-preview (+future Claude) to MTOK_PRICES; add a regression test that every DEFAULT_MODELS ∪ overrides value has a price match.
4. [code] **HIGH — no self-repair re-prompt on JSON parse failure** (base.py:252-277): one guarded attempt, then a hard raise. No repair re-prompt despite the skill+doc expecting one. Because every call site wraps complete_json in `except Exception: return deterministic()`, a single formatting slip discards an already-paid LLM output and silently falls back — invisible to the user and (per Finding 5) often to telemetry. Fix: on first parse failure issue one corrective re-prompt before raising — lifts JSON-valid-rate across all sites.
5. [code] **MED — telemetry blind spot on the unavailable-provider path.** monitor fires only inside complete(); call sites short-circuit to deterministic when provider is None (automation.py:94-95, match_reasoning.py:292-293), so a provider with a missing key/SDK degrades EVERY request to the template with zero events — looks identical to "no traffic." (A failed *call* does emit emit_error before being swallowed — that half is covered.) Fix: emit a lightweight source=deterministic/unavailable signal at the call-site boundary.
6. [code] **LOW/MED — no built-in caching in the wrapper;** dedupe is pushed to each call site (TS-side only), three separate hashing contracts (cache-key.ts, reasoning-cache-key.ts, automation-cache-key.ts). map() does no dedupe. devcase/campaign/jd_ingest/group_compare/weight_proposal have none. Fix: optional opt-in content-hash cache in TextProvider (respecting the source=="llm"-only policy).
7. [code] **LOW — _USE_CASE_BY_COMMAND (devcase_cli.py:51-58) omits 2-3 catalog use cases.** devcase_tooling/transfer/judge have no command mapping → fall to the default devcase_case_design → mis-tagged telemetry + config routed under the wrong (sonnet-stepped-up) use case. Fix: add the missing rows, or assert the map is a subset of the catalog in a test.
8. [code] **LOW — adapter parity:** cost stamping is uneven (Findings 2/3); otherwise usage incl. cached tokens IS normalized uniformly across adapters, and duration_ms is back-filled centrally — those parts are fine.

## Bench / Lens-3 readiness
The bench CAN run keyless today (default --targets claude_cli → MonitoredClaudeCli, no key). Metered targets need the SDK importable + key in env (build_provider reads env, not KP_LLM_CONFIG) and an explicit :deployment for azure. Unavailable targets become a skipped row (no crash). **Limiting gap:** with Findings 2/3 unfixed, the cost column is — for every non-Anthropic target, so the bench can't compare cost across providers — its stated purpose. Fix Findings 2/3 before relying on Lens-3 cost numbers.
