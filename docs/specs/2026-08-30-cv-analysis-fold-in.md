# cv_analysis fold-in: the multimodal CV path goes through the adapter door

Date: 2026-08-30 · Status: implemented with this spec
Registry technique: `software-engineering/module-design/seams-and-adapters`
(single-door rule; capability declared, not probed).

## Current state

- `pipeline/jobfit/pipeline.py:14` imports `analyze_profile_with_gemini` from
  `gemini.py` directly; that function calls `grounded_answer()`, which builds its
  own client (`get_client()`, env key only) against the hardwired `GEMINI_MODEL`
  (`gemini.py:26`). The enabling point — which provider/model/key serves
  `cv_analysis` — sits inside the code being varied: no config row, BYOM key, or
  model pin can reach it. This is kp's own documented single-door violation
  (docs/architecture/llm-provider-layer.md "Outstanding").
- `pipeline/jobfit/llm/capabilities.py` refuses to advertise `CAP_FILE_INPUT` on
  ANY row (the NOTE block) because every adapter's `_call` is text-only — the
  honest posture while the door didn't exist.
- `pipeline/jobfit/llm/registry.py:39-41` carves `cv_analysis`/`profile_extract`
  out of `_production_gemini_default` ("those keep their dedicated gemini.py
  path") — the registry knows the bypass exists and routes around it.

## Target shape

1. **The adapter contract gains the document verb.** `TextProvider` (llm/base.py)
   declares `complete_document(prompt, *, file=(bytes, mime) | None,
   use_grounding, response_mime_type, expected_keys, temperature,
   max_output_tokens)`; the base implementation raises `LLMError` naming the
   missing `file_input` capability — reached only on misconfiguration, because
   routing consults the capability matrix first (capability declared, not
   probed at call time).
2. **The Gemini adapter implements it** (llm/adapters/gemini_api.py), delegating
   to `gemini.grounded_answer` — which gains `model=` / `api_key=` threading so
   the adapter's configured model and BYOM key (not the module constants) drive
   the call, the retry loop, and the metering label. The offline seal
   (`_assert_egress_allowed`), the 25MB cap, blind mode, retries, and the
   usage-ledger metering all ride along unchanged because the engine is the same
   function.
3. **The capability matrix stops refusing**: the `gemini` row advertises
   `CAP_FILE_INPUT`; the NOTE narrows to the still-text-only rows. `cv_analysis`
   routed to gemini now resolves; routed to any text-only provider it still
   raises (unchanged).
4. **The registry carve-out retires**: when no config row exists and the CLI
   default cannot serve the use case (`unsupported_caps(use_case, "claude_cli")`
   non-empty, i.e. the file-input cases), `resolve_provider` returns the Gemini
   adapter in dev AND production — mirroring today's behavior where the CV path
   always went straight to Gemini on `GEMINI_API_KEY`. A missing key still
   surfaces at call time with the same actionable error as today (the adapter is
   returned un-gated on `available()`, exactly like the old direct path).
5. **The pipeline goes through the door**: `pipeline.py` resolves
   `provider = resolve_provider("cv_analysis")` and passes it to
   `analyze_profile_with_gemini(..., provider=provider)`; the function's model
   call becomes `provider.complete_document(...)`. Run metadata reports
   `provider.model` instead of the constant.
6. **Docs**: llm-provider-layer.md moves `cv_analysis` from Outstanding to
   ported (with the profile_extract residual noted).

## Consequences accepted

- `test_analysis_prompt_version_sync` fingerprints the SOURCE of
  `analyze_profile_with_gemini`; per that file's recorded convention, a routing
  refactor that changes no prompt byte re-records `EXPECTED_ANALYSIS_FINGERPRINT`
  with a NOTE and does NOT bump `PROMPT_VERSION` (no cached analysis output
  changes).
- `test_llm_registry.test_cv_analysis_raises_for_text_only_adapters` drops
  `gemini` from its loop (it is no longer text-only) and gains the positive
  assertion.

## Out of scope

- `profile_extract` fold-in (`extract_profile_text_with_gemini`) — same door,
  now available; folding it is a follow-up with its own callers to trace.
- Multimodal support in the openai/anthropic/azure adapters (the doc's larger
  Phase 3 ambition) — their rows stay honest text-only.
- Wildcard-config semantics: `{"*": {"provider": "claude_cli"}}` still raises
  for `cv_analysis` (an explicit route to an incapable provider is a
  misconfiguration, not a fallback trigger).

## Acceptance checks

- `resolve_provider("cv_analysis")` with no config returns the Gemini adapter
  stamped `use_case="cv_analysis"` (new test).
- Explicitly configured `{"cv_analysis": {"provider": "gemini"}}` resolves; the
  text-only providers still raise (updated test).
- `complete_document` on a text-only adapter raises `LLMError` (new test).
- `test_gemini_metering.test_cv_analysis_labels_itself` still passes — the label
  threads through the adapter unchanged.
- Scoped `python -m unittest` over `test_llm_registry`, `test_gemini_metering`,
  `test_analysis_prompt_version_sync`, `test_pipeline`, `test_pipeline_degrade`;
  `npm run typecheck` (TS mirrors unaffected — provider/use-case name sets are
  unchanged); the capabilities-lockstep unit test.
