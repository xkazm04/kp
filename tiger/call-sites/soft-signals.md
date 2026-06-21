---
id: soft-signals
type: tiger/call-site
modality: text
file: pipeline/jobfit/soft_signals.py:285
wrapper: none — DETERMINISTIC, no model call
provider: none  model: none
schema: typed SoftSignal/SoftSignalPanel dataclasses (models.py), constructed deterministically
grounding: 3/4 sources (for the panel's purpose)
quality_score: 4  code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[petra-recruiter]]", "[[tomas-hiring-manager]]"]
---
## What it does
Aggregates candidate-level antipatterns (overclaim, archetype contradiction, evidence thinness, tenure instability, vague delivery) + hidden strengths (potential, transferable meta-skills, ownership) into one SoftSignalPanel. Entry `build_soft_signal_panel(profile, job_fit=None)` (:285). **Deliberately LLM-free** (docstring :16 "Deterministic and LLM-free, cheap and unit-testable"). The only AI content it touches is *folding in* upstream output: `_folded_risk_flags` (:245) reads `job_fit.recruiter_risk_flags` (produced by **cv-analysis**, not here) at confidence 0.4. It feeds two loops: panel_to_probe_briefs (:265) → design_case focus_probes (a [[devcase]] LLM site); to_interview_checklist (deterministic).

## Prompt & grounding
No prompt — no model call. Assessed against the panel's job (CV → confirmable hypotheses): consumes CV evidence/skills/claims (_evidence_blob :58), archetype/provenance/potential engines, and upstream LLM flags at lower trust. **Missing (3/4): the specific JD/role** — build_soft_signal_panel takes no Job, so a flag isn't weighed against what this role needs. Senior bar: strong for Petra — every signal carries detail + confidence + needs_confirmation + suggested_probe; routes to interview/work-sample rather than deciding (hypotheses, not verdicts).

## Code quality (wrapping · logging · caching)
Wrapping n/a (correctly — regex/ratio detectors, not LLM). Typed dataclasses, no parse risk. No spend. Recomputed each call; _evidence_blob/_METRIC_RE run twice over the same evidence (:166 and :230) — cheap redundancy. Folded LLM flags inherit cv-analysis's cache transitively.

## Findings
1. [value] **Panel is role-blind (grounding 3/4).** (:285) never sees the Job. Fix: pass role requirements; tag each signal with role-relevance / order antipatterns by overlap with missing_must_haves. MEDIUM.
2. [code] **Double scan of work evidence** (:166 and :230 are exact inverses). Fix: compute metric_hits once and pass in. LOW.
3. [value] **Folded LLM risk flags surfaced verbatim, not grounded back to evidence** (:245). A hallucinated upstream flag presents like an evidence-backed one (only 0.4 confidence distinguishes). Fix: attach matching evidence id / down-rank flags with no overlap. LOW-MEDIUM (the flag *source* is [[cv-analysis]]).
