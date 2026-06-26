> Total: 6 findings (0c critical, 1h high, 2m medium, 3l low)

Context: "LLM Provider Layer (Python)" — `pipeline/jobfit/llm/` (base + 4 adapters + registry/capabilities/config/monitor + bench harness). This layer is unusually clean: no `print()`, no commented-out code, no TODO/HACK/FIXME, and the base class already owns retry / JSON-guard / `map()` / key-resolution so the per-adapter `_call` bodies are genuinely provider-specific SDK shapes (verified — see finding 2 for the one real residual dup). The findings below are the highest-value remaining items.

## 1. `LLMResult.raw` is written but never read anywhere — dead field + inconsistent population
- **Severity**: high
- **Category**: dead-code
- **File**: pipeline/jobfit/llm/base.py:104 (field); anthropic_api.py:55, openai_api.py:51 (writers)
- **Scenario**: `LLMResult.raw: dict` is declared on the frozen dataclass and populated by two adapters (anthropic stamps `{id, stop_reason}`, openai stamps `{id, finish_reason}`). Grepped the whole repo for any reader: `grep -rn "\.raw\b" pipeline/` and `grep -rn "result\.raw\|\.raw\[" pipeline/` → **zero attribute reads**; the only hits are the `raw=` constructor kwargs and unrelated `raw_use_cases`/`raw_keys` locals in config.py. Worse, the field is populated asymmetrically: gemini_api and azure_openai (via inherited openai `_call`) never set it, so even if something *did* read it, it would be unreliable. Bench `runner.record_calls` captures whole envelopes but only reads `.usage`/`.cost_usd`, never `.raw`.
- **Root cause**: Speculative "keep the provider's raw envelope around just in case" that no consumer (production call sites, monitor ledger, or bench) ever needed.
- **Impact**: Two adapters carry ~5 lines each of `getattr(resp, "id"/"stop_reason"/"finish_reason")` plumbing that produces values nothing consumes; readers are misled into thinking `raw` is a usable normalized field when it's empty for half the providers. Maintenance tax on the two adapters that bother.
- **Fix sketch**: Either (a) drop the `raw` field and the two `raw={...}` blocks entirely (smallest, honest), or (b) if a future need is real, populate it uniformly in all four adapters and add a test asserting a reader. Prefer (a) — reintroduce when an actual consumer appears.

## 2. usage-dict + `cost_usd` stamping tail duplicated across the 3 direct adapters
- **Severity**: medium
- **Category**: duplication
- **File**: pipeline/jobfit/llm/adapters/anthropic_api.py:51-65, openai_api.py:47-64, gemini_api.py:54-64
- **Scenario**: All three direct adapters end `_call` with the identical shape: compute `input_tokens`/`output_tokens`/`cached`, then build `LLMResult(text=..., provider=self.name, model=self.model, usage={"input_tokens":…, "output_tokens":…, "cached_tokens":…}, cost_usd=price_usd(self.model, input_tokens, output_tokens))`. Confirmed by grep across the three files — same key names, same `price_usd(self.model, …)` call. The genuinely-provider-specific part is only the *extraction* (anthropic `resp.usage.input_tokens` + `cache_read_input_tokens`; openai `usage.prompt_tokens`/`completion_tokens` + `prompt_tokens_details.cached_tokens`; gemini `_usage_metadata(resp)` dict). Azure correctly does NOT duplicate — it inherits openai `_call`.
- **Root cause**: The shareable assembly was left inline in each adapter alongside the non-shareable extraction.
- **Impact**: Three copies of the result-assembly + cost-stamping. If the usage dict grows a key (e.g. `reasoning_tokens`) or cost stamping changes, three edits are needed and drift is easy (it already happened once — the T0.2 fix had to touch all three to add `cost_usd`).
- **Fix sketch**: Add a `TextProvider._build_result(self, *, text, input_tokens, output_tokens, cached_tokens, raw=None) -> LLMResult` helper in base.py that owns the `usage` dict + `price_usd(self.model, …)` stamping; each adapter keeps only its provider-specific token extraction and calls the helper. Do NOT merge `_call` itself — the SDK calls and token field names legitimately differ. Modest win (~10 lines saved) but kills the cross-adapter drift class.

## 3. Capability matrix gates use cases (`cv_analysis`, `profile_extract`) that never route through this registry
- **Severity**: medium
- **Category**: dead-code
- **File**: pipeline/jobfit/llm/capabilities.py:13-14, 20, 47-48 (`CAP_FILE_INPUT`, `CAP_GROUNDING`, the `cv_analysis`/`profile_extract` rows)
- **Scenario**: `CAP_FILE_INPUT`/`CAP_GROUNDING` exist only to gate `cv_analysis` and `profile_extract`. Grepped every `resolve_provider(...)` call site in the repo (`grep -rn "resolve_provider" pipeline/`): the resolved use cases are automation, campaign_pack, jd_ingest, profile_draft, group_compare, devcase_*, weight_proposal, match_reasoning — **never `cv_analysis` or `profile_extract`** (`grep -rn "cv_analysis\|profile_extract" pipeline/jobfit/*.py` → no resolve usage; those paths still live in `gemini.py`). So the only non-`json` capability rows, the two non-`json` `CAP_*` constants, and the `grounding`-only difference for gemini gate traffic that cannot reach this layer.
- **Root cause**: Forward-design — the module docstrings (capabilities.py:24-26, gemini_api.py:4-6) explicitly say multimodal/grounded cases fold in "behind file_input/grounding ... until Phase 3." The capability *machinery* (`unsupported_caps`, `PROVIDER_CAPABILITIES`) is live and tested (`test_capability_mismatch_raises`), so this is intentional-but-unreached, not accidental dead code.
- **Impact**: Low real harm, but a reader can't tell "active routing rule" from "placeholder for a not-yet-migrated path." The grounding capability in particular has zero discriminating power today (no use case requires it).
- **Fix sketch**: Keep the machinery; either (a) add a one-line `# NOT YET ROUTED HERE — cv_analysis/profile_extract still resolve in gemini.py` marker on the two rows + the two `CAP_*` constants, or (b) drop them until the Phase-3 migration lands and reintroduce with the migration. Prefer (a) given the documented roadmap.

## 4. Azure `_resolved_endpoint` calls `load_local_env()` directly, bypassing the `_load_env` test-dispatch seam
- **Severity**: low
- **Category**: structure
- **File**: pipeline/jobfit/llm/adapters/azure_openai.py:41 (and the direct import at line 11)
- **Scenario**: The base establishes a deliberate seam — `TextProvider._load_env` does `getattr(sys.modules[adapter_module], "load_local_env", base.load_local_env)()` so a per-adapter monkeypatch intercepts env loading (base.py:178-183; tests patch `adapters.<name>.load_local_env`). Azure's `_resolved_endpoint` instead calls the module-level `load_local_env()` directly, sidestepping that seam. The other three adapters never call it directly — they import it only to satisfy the dispatch lookup (verified F401 re-imports are load-bearing: `test_llm_base.py:222/281/317` patch `<adapter>.load_local_env`, so they must NOT be removed).
- **Root cause**: Endpoint resolution was added bespoke in the Azure subclass and reached for the imported function directly rather than routing through `self._load_env()`.
- **Impact**: Minor inconsistency: a test that patches `azure_openai.load_local_env` to intercept *key* resolution wouldn't intercept *endpoint* resolution the same way (though it happens to work because both resolve to the same patched module symbol). Pattern divergence that future adapters might copy.
- **Fix sketch**: Replace the direct `load_local_env()` at line 41 with `self._load_env()` for consistency with the documented dispatch contract. Behavior-neutral.

## 5. `BenchTarget.label` property used in exactly one place; `_model_label` duplicates the same model-defaulting logic
- **Severity**: low
- **Category**: duplication
- **File**: pipeline/jobfit/llm/bench/runner.py:40-42 (`label`), 99-100 (`_model_label`), 205 (markdown)
- **Scenario**: `BenchTarget.label` (`f"{provider}:{model or 'default'}"`) is read in only one spot — the error message at runner.py:75 (grepped `\.label` in bench/ → that line plus unrelated `candidate.label` in scenarios.py). Meanwhile `to_markdown` (line 205) re-derives the same `provider:model` string inline rather than reusing `label`, and `_model_label(target, provider)` separately re-implements the `target.model or provider.model or "default"` defaulting that `label` half-does. Three slightly-different spellings of "name this target."
- **Root cause**: Property and helper added at different times; the markdown formatter and `_model_label` each rolled their own.
- **Impact**: Trivial — three near-identical formatting expressions. If the label format changes (e.g. include limit), they drift.
- **Fix sketch**: Either inline `label` into its single call site and delete the property, or (better) have `to_markdown` and the runner use one canonical formatter. Low priority — bench is a dev-only tool.

## 6. Repeated 5-line "imported so the base's `_load_env` dispatch resolves it here" comment block across 3 adapters
- **Severity**: low
- **Category**: cleanup
- **File**: pipeline/jobfit/llm/adapters/anthropic_api.py:12-14, openai_api.py:7-9, gemini_api.py:13-15
- **Scenario**: The same 2-3 line explanatory comment ("load_local_env imported so the base's _load_env dispatch ... resolve it here; _resolved_key/available live in base") is copy-pasted verbatim above the `from ..base import ... load_local_env ... # noqa: F401` line in three adapters. The import itself is load-bearing and correct (verified in finding 4), but the rationale is a non-obvious, repeated explanation of a base-class mechanism.
- **Root cause**: Each adapter re-documents a shared base behavior at the import site.
- **Impact**: Cosmetic. The mechanism is already documented once in base.py:178-183 (`_load_env` docstring); the triplicated comment is redundant and drifts if the seam changes.
- **Fix sketch**: Shorten each to a single line (`load_local_env: re-exported for base._load_env's per-module dispatch (see base._load_env)  # noqa: F401`) pointing at the canonical explanation, instead of repeating the full rationale three times. Pure tidiness.
