---
id: automation
type: tiger/call-site
modality: text
file: pipeline/jobfit/automation.py:97 (provider.complete_json); dispatched per-subtask via automation_cli.py:107 (resolve_provider("automation")) → automation-run.ts:183
wrapper: resolve_provider
provider: claude_cli (MonitoredClaudeCli) default; KP_LLM_CONFIG → anthropic/openai/azure/gemini
model: CLI default for all six subtasks (no --model). On anthropic adapter → claude-haiku-4-5 for the whole use_case (no per-subtask sonnet step-up exists)
schema: per-subtask coerce() closures (screen 281-298, outreach 344-352, rejection 387-396, prep 450-466, scorecard 601-637, offer 757-765); verdict pinned via coerce_recommendation (78-86); TS re-validates (automation-run.ts:76-85)
grounding: 4/5 (screen/prep/scorecard) down to 2/4 (outreach/rejection)
quality_score: 3  code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[petra-recruiter]]", "[[marek-coordinator]]"]
---
## What it does
One Python family, six LLM subtasks via _generate() (automation.py:92-101): **screen** (verdict+confidence+rationale, drives auto-advance), **outreach** (candidate-facing first contact), **rejection** (candidate-facing), **prep** (interviewer pack), **scorecard** (rubric ratings from transcript), **offer** (deterministic salary + LLM letter). rematch/policy mostly deterministic. Every subtask emits source + promptVersion. TS caches by input-hash, spawns Python, maps result→pipeline effect.

## Prompt & grounding (per subtask)
- **screen** 4/5 — reasoning_context + GH7 evidence + early-career flag; pre/post fairness gate forces hold for learnable-gap early-career (243,303-306), model can't override. Missing: prior comms/interview history.
- **prep** 4/5 — ctx + GH7 + language_directive(lang) (403-424). The ONE subtask threading cs/en correctly (CLI --lang).
- **scorecard** 4/5 — transcript (notes[:4000]) + fixed BARS rubric + GH7; demands verbatim-quote evidence (581-583); deterministic confidence band (527-543).
- **outreach** 2/4 [VALUE] — grounds on label/title/company/strengths only (318-326). Language = _candidate_lang (inferred from CV languages 110-112), NOT entry.locale. No brand/tone, no role detail.
- **rejection** 2/4 [VALUE] — label/title/company/stage/missing_skills (359-367). Same lang gap. **And see Finding 1: this draft is never sent.**
- **offer** — salary deterministic from band (716-731); letter restates the figure (good — load-bearing number is code-derived).

## Code quality (wrapping · logging · caching)
- **Wrapping** good: all six route resolve_provider → TextProvider/ClaudeCliProvider; deterministic fallback per subtask; _generate swallows any exception to fallback (100-101) — robust for batch volume.
- **Telemetry partial** [code]: monitor.emit_result → LightTrack only; **no llm_usage ledger** on this path (the known gap); LightTrack off by default → these calls are *unmetered* end-to-end. CLI subscription cost parsed (claude_cli.py:284) but never persisted.
- **Caching** good [code]: computeAutomationCacheKey hashes profile bytes + version + task + per-task axes (automation-cache-key.ts:73-90), 168h. Outreach/rejection drafts ARE deduped. (No lang axis for those, fine only because lang is derived from profile.)
- **Prompt bloat** ok; scorecard clamps notes to 4000. maxTokens uniform 2048 — sane; scorecard could clip on a 6-axis rubric.
- **Batch** ok; map() exists but unused here (concurrency lives in the TS orchestrator).
- **Language** [bug code/value]: only prep threads --lang; outreach/rejection/offer infer from candidate.languages and ignore entry.locale that comms-dispatch.ts:174 localizes on.

## Findings
1. [value] **HIGH — the LLM rejection draft is generated, cached, shown to the recruiter, but never sent.** draft_rejection (automation.py:359) produces a tailored body; automation-run.ts routes task==="rejection" to a record-only branch (46-49,301-303). The actual reject sends the **deterministic template** dispatchRejection (comms-dispatch.ts:189-200; pipeline/[id]/route.ts:239, command/route.ts:89, screen-wave.ts:280). The candidate always gets the generic template; the tailored draft dead-ends in the UI. Fix: wire the approved draft through dispatchRejection (fall back to template), OR drop the LLM rejection subtask — don't generate+bill+display an undeliverable draft.
2. [value] **MED — candidate-facing outreach/rejection language ignores the stored locale.** _candidate_lang (110-112) keys off CV languages, not entry.locale. Fix: pass entry locale into the prompts like prep does (--lang); add a lang cache axis for those tasks.
3. [code] **MED — no llm_usage ledger on the highest-traffic site** (base.py:220 LightTrack-only). With LightTrack off (default), outreach/screen/scorecard/offer are unmetered. Fix: emit one ledger row per complete().
4. [code] **LOW — no per-subtask model tiering** (capabilities.py has no automation override). The routing-critical screen verdict + candidate-facing prose run the same default tier. Lever for quality if needed.
5. [code] **LOW — uniform 2048 maxTokens; scorecard could clip.** Consider per-task params.maxTokens.

**Strengths (no fix):** fairness gate enforced in code pre+post-LLM, model can't override (243,303-307); offer salary deterministic; verdict taxonomy single-sourced + double-validated; outreach send idempotent + consent-gated (281-299) with audited suppression.
