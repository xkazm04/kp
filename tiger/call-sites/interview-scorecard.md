---
id: interview-scorecard
type: tiger/call-site
modality: text
file: pipeline/jobfit/automation.py:639 (interview_scorecard → _generate → complete_json :97)
wrapper: resolve_provider — but via use_case "automation", NOT "interview_scorecard" (routing collision)
provider: claude_cli (MonitoredClaudeCli)  model: CLI default
schema: no (hand-rolled coerce :601-637)
grounding: 4/5 sources
quality_score: 4  code_score: 3
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[tomas-hiring-manager]]", "[[katerina-ta-analytics]]", "[[lucie-dpo-compliance]]"]
---
## What it does
Synthesizes a structured, rubric-anchored interview scorecard from a transcript (Task 5). runInterviewScorecard (interview-run.ts:250) flattens the transcript → runAutomationTask(entryId,"scorecard",notes) → automation_cli scorecard → automation.interview_scorecard → complete_json (:97). Sets the scorecard_review approval (Interview→Offer gate) and seals a decision record.

## Prompt & grounding
The role-specific, calibrated design. Rubric single-sourced from interview-rubrics.json (read by BOTH Python automation.py:484 and TS interview-rubric.ts:15, CI-pinned), keyed by archetype scoringModel + role-family industry axes (520-524) — a nurse also scored on clinical judgment, a tradesperson on safety. Prompt injects per-competency BARS anchors (557-567), the 1-5 scale, and "evidence MUST be a near-verbatim candidate quote, rate 3/not-assessed when uncovered" (581-583). coerce re-emits EVERY competency in order with lenient name-matching (609-631); _scorecard_confidence widens the band for thin transcripts (527-543). **4/5**: transcript ✓, role-specific rubric+BARS ✓, GitHub evidence ✓ (577), protected-attribute handling — **no explicit instruction in the scorecard prompt** (the rejection prompt has one at :365, scorecard does not) ✗; prior calibration ✓ (the fixed shared rubric IS the anchor — Kateřina's consistency bar).

## Code quality (wrapping · logging · caching)
Routes resolve_provider ✓ with full deterministic fallback. promptVersion scorecard-v3 ✓; notes capped 4000 (572) + transcript head+tail sampled with a logged truncation warning (interview-run.ts:259-264). Weaknesses: (a) **use-case routing collision** — scorecard resolves the `automation` provider (automation_cli.py:107), so the `interview_scorecard` capabilities row (capabilities.py:45) is NEVER reached; an operator pinning a model for interview_scorecard has NO effect, and telemetry operation is `automation`; (b) **lang dropped** — automation_cli plumbs --lang only to prep; interview_scorecard neither accepts nor emits language_directive → Czech scorecard renders English and the verbatim-quote instruction risks the model translating quotes; (c) no typed schema; (d) **audit/determinism** — temperature unset, raw LLM output not persisted; ledger gap.

## Findings
- [code] **HIGH — use_case routing collision** (automation_cli.py:107,137-139). Scorecard runs under `automation`, so the interview_scorecard config/telemetry row is dead. Fix: resolve interview_scorecard for the scorecard command.
- [code] **HIGH — lang not threaded** (automation.py:546-645). Czech scorecard summaries render English; verbatim quotes can be translated. Fix: add lang + language_directive + "keep candidate quotes verbatim in their original language."
- [value] **MED — no protected-attribute instruction** in the scorecard prompt (570-588), unlike draft_rejection (:365). Add "rate only on rubric competencies; ignore name/gender/age/origin" (Lucie).
- [code] **LOW — no typed schema / expected_keys;** carried by coerce + deterministic fill.
- [value] **LOW — raw LLM scorecard not persisted for audit** (only coerced + promptVersion). Consider storing the raw response hash on the sealed decision.
