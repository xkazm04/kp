---
id: weight-proposal
type: tiger/call-site
modality: text
file: pipeline/jobfit/weight_proposal.py:147
wrapper: resolve_provider
provider: claude_cli (MonitoredClaudeCli)  model: CLI default
schema: no (hand-rolled _coerce :108-129)
grounding: 5/6 sources
quality_score: 4  code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[katerina-ta-analytics]]", "[[lucie-dpo-compliance]]", "[[tomas-hiring-manager]]"]
---
## What it does
Proposes per-candidate scoring weights (skills/career/personal) for ONE role in a SINGLE pool-level call, so weighting is cohort-relative. Via recruiter_cli --weights-llm → resolve_provider("weight_proposal") (recruiter_cli.py:91) → fairness_check (recruiter.py:32) → generate → complete_json (:147). Group eval opts in for --weights-llm + --embeddings (group-eval-run.ts:169-174); the cheap list endpoint stays deterministic.

## Prompt & grounding
Strongest-grounded of the family. Context (:37-76) sends per candidate: archetype, baselineWeights, the HARD weightBounds, dimensionScores, matchedMustHaves WITH provenance (observed > professional > internship/open_source), missingMustHaves, potentialScore + the role's must-haves. **5/6**: scores ✓, role rubric ✓, prior calibration (baseline + bounds) ✓, per-candidate evidence/provenance ✓, blindness partial (no demographics; system says "never let one signal erase a dimension", "fair" :30-34) ✗ explicit instruction. Senior bar: clears it well — output is advisory, evidence-anchored, and **mathematically bounded downstream** so a biased proposal CANNOT dominate or zero a dimension (resolve_weights clamps + renormalizes, matching.py:478-509; fairness_matrix re-scores the pool under every scheme, :649). Exactly the defensible, calibratable design.

## Code quality (wrapping · logging · caching)
Routes resolve_provider ✓; deterministic twin matching.propose_weights ✓; _coerce backfills per-candidate (:127-129). ONE pool-level call, not N (test asserts calls==1, test_weight_proposal.py:72) — no bloat. Good test coverage. Caching: rides the persisted group eval. Weaknesses: (a) **lang dropped** — generate accepts lang (:135) but fairness_check (recruiter.py:19-38)/recruiter_cli never pass it → rationale always English; (b) no typed schema; (c) **audit** — only the FINAL bounded schemes ride back; the RAW (pre-clamp) LLM proposal is not recorded, so an auditor can't see how far the model was from the bound; (d) ledger gap.

## Findings
- [code] **HIGH — lang not threaded** (recruiter.py:19-38; recruiter_cli.py:91-95). Fix: add lang param to fairness_check; plumb recruiter_cli --lang → generate(…, lang=…).
- [value] **MED — raw (pre-clamp) LLM proposal not persisted** (recruiter.py:32-37). Fix: record both proposed and resolved weights so a reviewer sees the clamp acted. (Mitigated by enforced bounds, so MED not HIGH.)
- [code] **MED — no explicit protected-attribute-blindness instruction** in _SYSTEM (:30-34). Blind by omission today; add an explicit "ignore name/gender/age/origin" line (Lucie).
- [code] **LOW — no typed schema / expected_keys;** carried by _coerce + deterministic backfill.

**Strongest design in the codebase:** mathematically-enforced per-archetype bounds + cross-scheme fairness_matrix mean a biased LLM weight can never dominate — the right answer to Lucie's non-discrimination bar.
