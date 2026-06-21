---
id: match-reasoning
type: tiger/call-site
modality: text
file: pipeline/jobfit/match_reasoning.py:296
wrapper: resolve_provider
provider: claude_cli (MonitoredClaudeCli)  model: CLI default (anthropic adapter default = claude-haiku-4-5)
schema: hand-rolled _coerce (match_reasoning.py:252) + complete_json JSON guard (base.py:252); no declarative schema/validator
grounding: 5/6 sources
quality_score: 4  code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[petra-recruiter]]", "[[tomas-hiring-manager]]"]
---
## What it does
Per-candidate↔job hiring rationale (verdict, strengths, gaps, interviewProbes). Call: `provider.complete_json(prompt, system=_system_for(job))` (match_reasoning.py:296). generate() (:277) builds a compact context via reasoning_context() (:50), builds prompt (:99), coerces, returns (reasoning, "llm"|"deterministic"). Provider None → deterministic (:293); exception → deterministic (:298). Callers: reasoning_cli.py:60 (resolves at :57), reasoning-run.ts:84, api/match/reasoning/route.ts:10.

## Prompt & grounding
System role/market-aware (_system_for :24) demands "at least one concrete, candidate-specific detail." Prompt (build_prompt :99) injects archetype lenses + full context JSON + "cite ≥1 concrete detail … never generic boilerplate" (:132). Sources reaching it (reasoning_context :50): CV facts (summary, top-5 highlights, workLinks, skills[:25]), the specific JD, score drivers (sub-scores + matched/missing), archetype/provenance, seniority/education. **Missing (5/6): prior pipeline context** — no screening verdict/recruiter notes/interview history, even though automation.py computes a screening verdict on the same pair. Senior bar: strong — drivers in-prompt, _coerce backfills empty verdict/strengths from the deterministic template (:268-273). Residual: model is instructed but not verified to cite a real fact — a boilerplate strength can still pass _coerce.

## Code quality (wrapping · logging · caching)
Routes through resolve_provider("match_reasoning") (reasoning_cli.py:57), capability-gated, double fallback. complete_json adds JSON guard + repair + expected_keys — but this site does NOT pass expected_keys, while build_prompt:128 prints an example object (mis-parse risk). Telemetry: monitor.emit_result → LightTrack only; no durable ledger. **Caching: good** — reasoning-run.ts:73 keys on promptVersion + candidate content hash + jobId + full job payload + lang + corpus fingerprint; only source:"llm" stored (policy.ts:16), TTL 168h, version CI-guarded. Prompt bloat: low (digest, not raw CV+JD). maxTokens 2048 ample.

## Findings
1. [value] **No prior-pipeline context (grounding 5/6).** reasoning_context (:50) never folds in the screening verdict/recruiter notes automation.py already produces. Fix: add an optional `prior` block to the context + prompt. MEDIUM.
2. [value] **"Cite a concrete fact" is instructed, not verified.** _coerce (:252) only checks non-empty. Fix: cheap post-check — if no strength token overlaps experienceHighlights/summary/skill tokens, backfill from deterministic (:268). MEDIUM.
3. [code] **complete_json without expected_keys while the prompt prints an example** (build_prompt:128). Fix: pass expected_keys=("verdict","strengths","gaps","interviewProbes") at :296. LOW-MEDIUM (latent mis-parse → silent fallback).
4. [code] **Metered reasoning spend not durably recorded** (cost computed base.py:46 but LightTrack-only). Fix: persist a ledger row after a source:"llm" success. MEDIUM.
