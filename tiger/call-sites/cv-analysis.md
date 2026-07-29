---
id: cv-analysis
type: tiger/call-site
modality: vision
file: pipeline/jobfit/gemini.py:371 (analyze_profile_with_gemini) → grounded_answer :487 → model call :275
wrapper: direct Gemini SDK (genai.Client.models.generate_content; bypasses llm/ resolve_provider)
provider: Google Gemini  model: gemini-3-flash-preview (gemini.py:25)
schema: yes — ANALYSIS_RESPONSE_SCHEMA in-prompt (gemini.py:28-135,:403); response_mime_type=json (:490); coerced in pipeline.py (_profile_from_payload :433, _score_from_payload :175, _salary_from_payload :181) + TS analysisSchema.safeParse (analyze-run.ts:145)
grounding: 4/4 mandatory (+1 conditional Google-Search)
quality_score: 4  code_score: 4
recommended_model: keep Gemini (multimodal ingest is Gemini-only); reasoning not a switch reason
status: benchmarked
last_scanned: 2026-07-16
characters: ["[[petra-recruiter]]", "[[katerina-ta-analytics]]"]
---

> **2026-07-16 Lens-3 benchmark → [[models/cv-analysis]]** (blind-text path, Claude-only).
> **Keep Gemini** — the PDF/vision ingest is Gemini-only. Two wins confirmed across ALL Claude
> tiers incl. haiku: (1) **injection resistance** held (the embedded "score 100" line was
> refused + flagged); (2) **currency inference correct** (EUR not CZK) — proving this prompt is
> NOT currency-locked, unlike [[grounded-salary]]. Caution: sonnet-high **hallucinated tenure**
> (7y vs 5y) + over-leveled — reinforces a **derived-fact post-check** (years/seniority
> consistency), the cheap model-independent guard. code_score 3→4 (retry now wired + metered).
## What it does
The flagship. One multimodal Gemini call reads the CV file (PDF/image) + JD/company/evidence and returns the whole structured analysis (profile, score sub-totals, salary band, market_evidence, job_fit). Entry: POST /api/analyze → analyze-run.ts:runAnalyze → spawnPython(pipeline.jobfit.cli) → pipeline.py:142 → gemini.py:371. UI: the candidate analyze workspace / report.

## Prompt & grounding
System "precise HR analyst" + full JSON schema as the shape contract + role-family catalog + deterministic pre-pass evidence + anti-hallucination rules (":469 do not invent facts", credential gate :471, salary must name market+basis :463-465). Real context reaching it: (1) CV — raw bytes (:489) or redacted text in blind mode (:478); (2) the specific JD (:476), job_fit nulled when absent (:414); (3) company/brand (:477); (4) deterministic evidence/anchor band (:456). Grounded salary market = conditional 5th source. Net **4/4 mandatory**. Senior bar: clears it on design — salary carries currency/period/basis + rationale array (:99-108,:463), matching_skills re-verified against the real CV text post-call (pipeline.py:199-209) so a hallucinated skill never reaches Petra's chips.

## Code quality (wrapping · logging · caching)
- Wrapper bypass: direct SDK by design (multimodal+grounding live outside the wrapper, config.md). Cost of the bypass is below.
- **Retry DEFINED but NOT WIRED:** grounded_answer calls generate_content directly (gemini.py:275-279); `_generate_with_retry` (:213) has **zero callers**. A single 429/5xx/90s-timeout aborts the whole expensive multimodal call. Documented unfixed since biz-ui-scan-2026-06-12. One-line fix; covers profile-extract + grounded-salary too (shared seam).
- Telemetry/ledger: invisible. gemini.py imports no monitor/LightTrack/ledger. Tokens extracted (_usage_metadata :323) but only land in a local pipeline log (pipeline.py:355). TS debits coarse recordMeterUsage("ai_candidates") (analyze-run.ts:180), not token cost.
- Cost stamp: none. MTOK_PRICES (base.py:39-43) has only Claude rows → price_usd(gemini…) = None. The flagship spend is uncosted.
- Caching: GOOD. computeCacheKey over cvBytes+JD+company+grounding+lang+blind (analyze-run.ts:97-106); lookup/store :108/:150.
- Truncated-JSON self-repair: present (_parse_truncated :589, _repair_truncated_json :627).
- temperature=0.1, max_output_tokens=16000 (:492-493) — reasonable.

## Findings
1. [code] **Retry helper never wired** — gemini.py:275-279 vs orphan :213. HIGH (every CV analysis; flagship path; a transient blip discards a paid multimodal+grounding call). Fix: call `_generate_with_retry` in grounded_answer; add a 503-then-200 test. Covers all 3 Gemini sites at one seam.
2. [code] **Zero cost/usage observability** — no ledger emission, no Gemini MTOK_PRICES row (base.py:39). HIGH for Kateřina's auditability (the most expensive call is financially invisible). Fix: add gemini-3-flash-preview to MTOK_PRICES + emit one ledger row from analyze-run.ts/pipeline.py using returned gemini_usage.
3. [value] **Determinism gap** — temperature 0.1 (not 0.0) on a scoring call (:492). MEDIUM (run-to-run score jitter on the same CV; cache masks it for identical inputs). Fix: 0.0 for the scoring/extraction call (extract path already 0.0 at :356).
