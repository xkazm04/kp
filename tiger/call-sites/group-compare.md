---
id: group-compare
type: tiger/call-site
modality: text
file: pipeline/jobfit/group_compare.py:157
wrapper: resolve_provider
provider: claude_cli (MonitoredClaudeCli)  model: CLI default
schema: no (hand-rolled _coerce :132-144)
grounding: 4/6 sources
quality_score: 3  code_score: 3
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[katerina-ta-analytics]]", "[[lucie-dpo-compliance]]", "[[tomas-hiring-manager]]"]
---
## What it does
Layer-D comparative "compare all" narrative across a role's candidates. runGroupEval (group-eval-run.ts:183-238) assembles a per-candidate digest, writes compare.json, spawns group_compare_cli (:223) → provider.complete_json (group_compare.py:157). Output (headline, keyPoints, recommendation) is _coerced + persisted by role_key. In `recommendation` mode it auto-seals a `group_eval_lead` decision record (group-eval-run.ts:418-427) — **an EU-AI-Act significant decision.**

## Prompt & grounding
Grounded in a real structured digest, not raw dumps — per-candidate label/archetype/seniority/total + dimension percents, matched/missing, verdict, potentialScore, same-currency-gated salary midpoint. Good controls: salary withheld on currency mismatch (210-217); capped at 6 sorted by fit; system pins "grounded ONLY in supplied facts" (:23-27). Grounding **4/6**: scores ✓, **role rubric/requirements ✗** (requirements computed in runGroupEval but NOT in the compare context — narrative can't reason about must-have vs nice-to-have), protected-attribute-blindness partial (blind by omission, not instruction; early-career fed as archetype), prior calibration ✗, verdict ✓, budget band ✓. Senior bar: evidence-based and honest, but without the rubric structure the "single deciding factor" can latch onto a non-required skill — a defensibility gap.

## Code quality (wrapping · logging · caching)
Routes resolve_provider ✓ with deterministic_comparison fallback. Caching: persisted by role_key (upsert); reopening the modal does NOT recompute ✓; regeneration is an explicit task. maxTokens 2048 sane. Weaknesses: (a) no typed schema — hand _coerce, no expected_keys pin though base supports it (base.py:258); (b) **lang dropped** — generate accepts lang (:148) but group_compare_cli calls generate(context, provider=) with no lang (group_compare_cli.py:50), TS context carries no locale → AI comparison ALWAYS English; (c) **audit/determinism** — temperature unset; the RAW prompt + RAW LLM response are never persisted (only the coerced result lands in payload_json) — weak for an auto-sealed significant decision; (d) ledger gap.

## Findings
- [value] **HIGH — role requirements/must-have structure not in the prompt** (group-eval-run.ts:192-219). "Single deciding factor" can be a non-required skill. Fix: add requirements (computed at :372) to the compare context + instruct to weigh must-have coverage first.
- [code] **HIGH — lang not threaded** (group_compare_cli.py:50). Czech recruiter's AI comparison renders English. Fix: pass lang through context/CLI into generate(context, lang=…).
- [value] **HIGH — auto-sealed group_eval_lead records the coerced summary, not the model's narrative/prompt** (group-eval-run.ts:418-427). Fix: persist promptVersion + raw LLM output (or hash) on the sealed decision for EU-AI-Act traceability.
- [code] **MED — no typed schema/self-repair.** Fix: complete_json(expected_keys=("headline","keyPoints","recommendation")).
- [model] **LOW — temperature not pinned;** reproducibility for an auditable decision not guaranteed.
