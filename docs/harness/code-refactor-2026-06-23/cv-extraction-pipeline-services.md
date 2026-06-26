> Total: 6 findings (0c critical, 2h high, 2m medium, 2l low)

## 1. `_generate_with_retry` is dead code that masks a missing retry path
- **Severity**: High
- **Category**: dead-code
- **File**: pipeline/jobfit/gemini.py:213-235 (also its only consumers `_is_transient_error` :195 and `_MAX_GEMINI_ATTEMPTS` :192)
- **Scenario**: `_generate_with_retry` is defined but never called. `grep -rn "_generate_with_retry"` over `pipeline/` (worktrees excluded) returns ONLY the definition line — no call site, no dynamic/`getattr` reference. The actual model call in `grounded_answer` (the documented "single seam for every Gemini-backed feature", :250) calls `client.models.generate_content(...)` directly at :275, bypassing the retry wrapper entirely. `_is_transient_error` and `_MAX_GEMINI_ATTEMPTS` are referenced ONLY inside the dead function, so they are dead-by-transitivity.
- **Root cause**: A bounded-retry helper was added (its docstring explains 429/5xx/timeout recovery and the exponential backoff) but `grounded_answer` was never re-pointed through it — it still does a single raw `generate_content`.
- **Impact**: Worse than inert: the retry behaviour the docstring promises ("one blip used to abort an analysis a single retry would have completed") does NOT happen in production. A transient Gemini 429/503/timeout still aborts the whole expensive analysis with no retry, exactly the failure the helper was written to prevent. ~25 lines of code (helper + two constants) read as a working safety net but are inert.
- **Fix sketch**: Decide intent. Either (a) route `grounded_answer`'s `generate_content` call through `_generate_with_retry(client, contents, config_kwargs)` so the retry actually applies, OR (b) if retry is deliberately disabled, delete `_generate_with_retry`, `_is_transient_error`, and `_MAX_GEMINI_ATTEMPTS`. Option (a) is almost certainly the intent given the docstring.

## 2. `_scan_json_values` + prose-JSON extraction duplicated across `gemini.py` and `claude_cli.py`
- **Severity**: High
- **Category**: duplication
- **File**: pipeline/jobfit/gemini.py:526-541 (`_scan_json_values`) + 564-586 (`_parse_json` fence/scan logic); duplicated in pipeline/jobfit/claude_cli.py:292 (`_scan_json_values`) + 334-336 (identical fenced-block + scan flow)
- **Scenario**: `grep -rn "_scan_json_values"` shows two independent definitions in the same package — `gemini.py:526` and `claude_cli.py:292` — each with its own `re.findall(r"\`\`\`(?:json)?\s*(.*?)\`\`\`", ..., re.DOTALL)` fenced-block pass then a raw `_scan_json_values(text)` fallback. The two `_scan_json_values` bodies are byte-for-byte the same JSON-decoder walk.
- **Root cause**: Two LLM backends (Gemini, Claude CLI) each grew their own "extract the JSON object out of prose-wrapped model output" parser instead of sharing one. (Note: `llm/base.py` already has `is_transient_error` with a docstring "Same policy as gemini._is_transient_error, generalized across SDKs" — the same generalize-but-forgot-to-converge pattern.)
- **Impact**: Two copies of a subtle parser (string-state tracking, multi-object selection) drift independently. The selection tie-break already differs (gemini ranks by `expected_keys` match count + size; claude takes "last value carrying any key") — so a fix to one (e.g. the documented "stray trailing citation object" bug) silently won't reach the other.
- **Fix sketch**: Extract `_scan_json_values` and the fenced-block harvesting into one shared helper (e.g. a `json_extract.py` or reuse `llm/base._extract_json`) and have both `gemini._parse_json` and `claude_cli._parse_json` call it, keeping only their differing payload-selection policy local. Reduces two parser copies to one.

## 3. `_credentials_from_payload` / `_publications_from_payload` are near-identical coercion twins
- **Severity**: Medium
- **Category**: duplication
- **File**: pipeline/jobfit/pipeline.py:390-410 and 413-430
- **Scenario**: The two functions are structurally identical: `isinstance(raw, list)` guard → per-item `isinstance(dict)` skip → required-field (`name`/`title`) strip-and-skip-if-empty → `kind` lowered and validated against a 2-member allow-set with the same default → append a model. Confirmed by reading both bodies; they differ only in the model class, the required field name, and the `{license, certification}` vs `{publication, patent}` allow-sets.
- **Root cause**: Two payload-list coercers written by copy-paste rather than parameterizing the one varying axis (model ctor + required key + kind allow-set/default).
- **Impact**: Low blast radius but real maintenance drift — a fix to the coercion contract (e.g. tolerating a list-valued field, trimming a new optional column) must be hand-applied twice and one can be forgotten.
- **Fix sketch**: A single `_coerce_kinded_list(raw, *, required_key, build, kinds, default_kind)` helper, or a tiny table-driven loop, that both call. Keeps each model's field mapping in a one-line `build` lambda.

## 4. `extract_profile_text_with_gemini` is reachable only from a test
- **Severity**: Medium
- **Category**: dead-code
- **File**: pipeline/jobfit/gemini.py:341-368
- **Scenario**: `grep -rn "extract_profile_text_with_gemini"` over `pipeline/`, `scripts/`, `app/` (worktrees excluded) returns the definition plus ONLY `tests/test_pdf_parsing_quality.py` (import :8, call :60). No production caller. The live extraction path is `pipeline._extract_pre_pass` → `extractors.extract_text` (pypdf/docx), and the LLM read happens inside `analyze_profile_with_gemini`, which does its OWN extraction prompt — it does not call this function.
- **Root cause**: A standalone Gemini text-extraction entry point that was superseded when extraction folded into the single `analyze_profile_with_gemini` call; the function survives only because a parsing-quality test still exercises it.
- **Impact**: ~28 lines (with a distinct 12k-token prompt and its own `expected_keys` schema) that look like part of the production extraction path but aren't — a reader must trace callers to learn it's test-only, and the test pins a code path nothing ships.
- **Fix sketch**: Confirm with the team whether the parsing-quality test should instead assert against the production path. If so, delete the function and retarget the test; if the test is intentionally a Gemini-extraction microbenchmark, mark the function clearly as test-support (docstring "used only by test_pdf_parsing_quality") so it isn't mistaken for a live seam.

## 5. `panel_to_probe_briefs` is built/documented as a live bridge but never called outside tests
- **Severity**: Low
- **Category**: dead-code
- **File**: pipeline/jobfit/soft_signals.py:265-282
- **Scenario**: `grep -rn "panel_to_probe_briefs("` (excluding the def) returns only `tests/test_soft_signals.py:117,123`. The only non-test mention is a docstring reference in `devcase/design.py:200`. The docstring claims it is "the Rec B bridge … consumed by `design_case(focus_probes=…)`", and `design_case` does accept `focus_probes` (design.py:195), but no production code wires the panel's briefs into that call — only the test does (`design_case(..., focus_probes=briefs)` at test line 128).
- **Root cause**: The CV-hypothesis → targeted-probe loop was implemented end-to-end at the helper + test level but never connected in a live pipeline path (mirrors the "built-but-unwired" theme noted across this codebase).
- **Impact**: Inert public API. Not harmful, but a reader trusting the docstring will assume the loop is active in production when it is exercised only by a unit test.
- **Fix sketch**: Either wire `panel_to_probe_briefs(panel)` into the devcase design flow where `analyze_cv` produces `soft_signals` (so the documented Rec B loop actually runs), or soften the docstring to "available for callers that want to feed `design_case(focus_probes=…)`" so it doesn't assert a live integration that isn't there.

## 6. Stale "previously never called" / historical comments left inline in pipeline.py
- **Severity**: Low
- **Category**: cleanup
- **File**: pipeline/jobfit/pipeline.py:310-311 ("soft_signals.py — built+tested but previously never called"); also the long historical-rationale block at :242-249 ("The old third argument … was a dead tautology …")
- **Scenario**: Read in place. These comments narrate the *history* of a now-fixed defect ("previously never called", "the old third argument was a dead tautology") rather than describing current behaviour. They are accurate but archaeological.
- **Root cause**: Fix-time rationale comments retained verbatim after the fix landed.
- **Impact**: Cosmetic. They add length and make a reader parse a removed-code story to understand current code; "previously never called" can mislead a skimmer into thinking the call is still absent.
- **Fix sketch**: Trim to the forward-looking invariant — e.g. for :310-311 keep "Soft-signal panel under its own _softly umbrella so a panel bug degrades to None + a skip note" and drop the "previously never called" clause; condense the :242-249 block to the one-line current contract (coverage harvests the JD keyword universe from JD text). Low priority — leave if the team values the audit trail.
