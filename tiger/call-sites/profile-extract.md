---
id: profile-extract
type: tiger/call-site
modality: vision
file: pipeline/jobfit/gemini.py:341 (extract_profile_text_with_gemini) → grounded_answer :352 → model call :275
wrapper: direct Gemini SDK (via grounded_answer; bypasses resolve_provider)
provider: Google Gemini  model: gemini-3-flash-preview (gemini.py:25)
schema: yes — inline contract (raw_text, structured_profile, parsing_notes :348-349); response_mime_type=json (:357); expected_keys (:359); isinstance guards (:362-366)
grounding: 1/1 source (CV bytes)
quality_score: 3  code_score: 3
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[petra-recruiter]]", "[[katerina-ta-analytics]]"]
---
## What it does
Multimodal extraction-only call: reads the CV and returns raw_text + light structured_profile + parsing_notes. **NO production caller** — only reached from a skipped live-key test (test_pdf_parsing_quality.py:60). The production path extracts inside `analyze_profile_with_gemini` (pipeline.py:142, AnalysisMetadata.text_extractor="gemini" :283). Dead/test-only since code-refactor-2026-06-14.

## Prompt & grounding
Single prompt: extract profile text, preserve Czech diacritics, reconstruct letter-spaced PDF words, strict JSON 3 keys (:344-351). In-scope context = the CV file only, reaches the model (1/1, :354). Senior bar n/a as a standalone product surface (no scoring/salary/JD) — it's an extraction primitive.

## Code quality (wrapping · logging · caching)
- Same shared seam as cv-analysis (grounded_answer :275) → inherits the unwired-retry bug + no-telemetry/no-ledger/no-cost gap.
- No caller-side cache (not through analyze-run.ts) — moot today (no prod caller).
- temperature=0.0, max_output_tokens=12000 (:356-357) — correct for deterministic extraction.
- parse_json + expected_keys + type guards + RuntimeError on empty (:359-367) — solid.

## Findings
1. [code] **Dead production path masquerading as live plumbing** — gemini.py:341, only test caller. LOW (never in prod; maintenance tax). Fix: delete it and fold the test into the analyze path (real extraction lives in the combined call).
2. [code] **Inherits shared grounded_answer gaps** (unwired retry, no ledger, no Gemini price row). LOW here (no live caller) — fixing at the grounded_answer seam covers this for free if ever wired.
