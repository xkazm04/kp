# Biz+UI Scan — Dev Case Python Engine (2026-06-12)

> Total: 5 (2H/3M/0L)

## 1. Stop shipping silently-degraded seeds and interview scenarios as healthy successes
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `pipeline/jobfit/devcase/seed_materializer.py:190`
- **Scenario**: At publish time the orchestrator generates the interview scenario and the materialized seed. The Claude CLI times out or returns garbage; the candidate receives a "seed" containing only README.md + DECISIONS.md (the deterministic skeleton — its own `note` admits "starting materials remain prose"), the voice interview runs on the crude template probes — and the recruiter's audit trail says `seed_materialized` success with the note "interview scenario ready; seed materialized".
- **Root cause**: `materialize_seed` (seed_materializer.py:184-193) and `scenario_from_case` (interview_scenario.py:199-206) are the only two generation steps that bypass `provenance.generate_with_fallback` — a bare `except Exception` swallows the cause with no WARNING log and no `FALLBACK_REASON_KEY`, so the CLI envelope's `fallbackReason` block (devcase_cli.py:109-152) is structurally empty for these commands, despite provenance.py:12-17 claiming the contract covers every step. Downstream, `devcase-orchestrator.ts:132` and `:150` destructure only `{ scenario }`/`{ seed }`, discard `source`, save unconditionally, and record a success audit (`:153`).
- **Impact**: The anti-essay-grading hardening — the docstring's own verdict is that a prose seed is "essay-grading a model can ace" — silently doesn't happen for an entire cohort: submissions stop being diffs against shared ground truth, probes have no concrete files to live in, and evaluations degrade, all while the operator surface reports green. This is exactly the "dangerous false-green" pattern the W5 fixes eliminated for the other four steps.
- **Fix sketch**: Route both modules through `generate_with_fallback` (their `deterministic`/`coerce` closures already exist; adapt the model-returning coerce as the others do), and lift reasons in devcase_cli via the existing `_fallback_reasons(seed=…)` / `(scenario=…)` helper. In the orchestrator, persist `source` alongside the seed/scenario JSON (`saveDevCaseSeed`/`saveDevCaseScenario` already store blobs), record a distinct `seed_skeleton_only` audit when `source !== "llm"`, and badge the degraded state in CaseDetail using the same provenance-strip pattern the design steps already render.

## 2. Make observed-skill minting honest: gate the take-home path on evidence confidence and stop crediting unmatched/gap skills
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `pipeline/jobfit/live_case.py:87`
- **Scenario**: A submission's evaluation ran on a degraded provider — the tooling signal fell back deterministic (confidence 0.2, which models.py:59-61 says to "treat as a weak hint only") and the propagated evaluation/transfer confidence is 0.2. The transfer score still averages to 68, so on promote the candidate's profile gains `observed`-provenance evidence (taxonomy weight 1.0, "the highest-trust signal the scoring engine knows") for EVERY role must-have — including ones the transfer assessment explicitly listed under `gaps` — plus the early-career routing confidence lift. Their next match outranks honestly-assessed peers.
- **Root cause**: Two holes in the same minting flow. (a) `observed_evidence` gates only on `transfer_score >= 65` (live_case.py:87-89) and never reads `evaluation.confidence`/`transfer.confidence` — the propagated-confidence machinery built precisely so "a decision resting on degraded/fallback evidence is never presented as authoritative" (models.py:63-69, evaluate.py:67-81) has zero consumers at the single highest-stakes decision point; the sibling interview path DOES refuse to mint on a wide-confidence scorecard (live_case.py:169-171), so the deeper-trust path is the less-guarded one. (b) `_credited_skills` returns `matched or musts` (live_case.py:70): when the enumerated transfers match no must-have — always true on the deterministic transfer path, whose `transfers` are dimension labels like "Strong framing" (evaluate.py:227-229), never skills — ALL must-haves are credited, and `transfer.gaps` is never consulted.
- **Impact**: Fabricated top-trust evidence contradicts the module's "honest by construction" contract and directly skews shortlists and match scores — the product's core differentiation vs a typical ATS is that observed evidence is earned, not inferred.
- **Fix sketch**: In `observed_evidence`, require `transfer.confidence > LOW_CONFIDENCE` (mirroring the interview path's wide-confidence kill, threshold already exported from models.py); in `_credited_skills`, exclude must-haves whose normalized name appears in `transfer.gaps`, and when nothing matched credit nothing (or musts-minus-gaps with a reduced `Evidence.confidence`) instead of everything. Return a third element / `reason` from `apply_live_case` so callers can report what happened (pairs with finding 3).

## 3. Tell the recruiter WHY no observed skills were credited
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: user_benefit
- **File**: `pipeline/jobfit/live_case.py:117`
- **Scenario**: A recruiter promotes an evaluated submission and the response carries `observedSkills: []`. Below the bar? Ambiguous candidateRef? No saved profile? Not early-career? Nothing says — the flagship "case → observed skills → better matching" loop is indistinguishable from a silent no-op, so the recruiter stops trusting (and using) it.
- **Root cause**: `apply_live_case`/`apply_interview_case` return empty `credited` with no reason even though both docstrings promise the caller can "honestly report" (live_case.py:120-122, 224-226); the TS wrappers have 4-5 silent precondition exits each (`devcase-run.ts:236-241`, `:317-324`), `recordAutomationEvent("observed_minted", …)` fires only on success (devcase-run.ts:282, 364), and the promote route swallows mint failures entirely (`app/api/devcase/promote/route.ts:22-26`).
- **Impact**: The engine's differentiating enrichment loop has no failure narrative — recruiters can't act on a withheld credit (e.g. fix an ambiguous candidateRef, or schedule the authorship interview after a near-miss), and debugging requires a terminal.
- **Fix sketch**: Emit a machine-readable reason from Python (`{"creditedSkills": [], "reason": "below_bar" | "low_confidence" | "no_must_haves"}` — devcase_cli already wraps the result envelope) and from each TS precondition exit; record an `observed_skipped` automation event with it; surface one line in the promote toast / EvalPanel ("Observed credit withheld: transfer 58 < 65"), following the existing `recordAutomationEvent` + provenance-note patterns.

## 4. Verify the materialized seed actually carries the case's traps (seed–probe coherence check)
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: functionality
- **File**: `pipeline/jobfit/devcase/seed_materializer.py:142`
- **Scenario**: The case's probes name concrete `where` anchors ("the legacy parser", "the thin test suite"). The LLM materializes a plausible-looking 8-file tree that never plants those traps (or returns all-markdown files for a software role). Every candidate on the case works a seed without the instrument; the evaluator then judges probe outcomes against traps that never existed and followups interrogate decisions nobody had to make.
- **Root cause**: `_coerce` validates only path safety, size caps, file count and DECISIONS.md presence (seed_materializer.py:142-173) — nothing checks that any probe's `where` is reflected in the tree or contents. Neither eval harness covers the seam: `lifecycle_eval._check_case` stops at the case JSON (lifecycle_eval.py:75-93) and `submission_eval` starts from synthetic commits — the one artifact candidates actually touch is the only one with zero health validation.
- **Impact**: Probe-based evaluation — the engine's central claim — silently measures noise whenever materialization drifts, and nobody can detect it before candidates have already spent their timebox.
- **Fix sketch**: Add a deterministic `check_seed(case, seed)` returning warnings (per-probe token overlap between `where`/`kind` and seed paths+contents; count of non-README/DECISIONS files; extension sanity vs the role's stack for software roles), stash them on the seed dict as `seedWarnings` so they ride the CLI envelope; have the orchestrator downgrade the `seed_materialized` audit to a warning when non-empty, and add the warning rate as a new `signals()` line in lifecycle_eval once seeds join the harness.

## 5. Stop cutting the spoken case intro mid-word at 600 chars
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `pipeline/jobfit/devcase/interview_scenario.py:163`
- **Scenario**: Every candidate's AI-led interview opens with the case narration. The LLM is prompted for "at most two minutes of plain spoken narration" (~1,500+ chars at speech pace) but `_coerce` hard-slices the reply at `intro[:_INTRO_MAX]` (600 chars ≈ 45 seconds) with no ellipsis and no boundary — so the voice agent routinely narrates a sentence chopped mid-word, identically to every candidate on the role.
- **Root cause**: `_INTRO_MAX = 600` under the comment "roughly two minutes of speech" (interview_scenario.py:51-52) contradicts the prompt's own "two minutes" instruction (build_prompt, :146-148), making overflow the common case, and the LLM path's truncation (:163-164) lacks even the `…` the deterministic path appends (:110-111).
- **Impact**: A mid-word cutoff in the product's most novel, candidate-facing surface reads as a broken product — direct employer-brand damage at the exact moment the company is trying to impress a candidate, repeated for the whole cohort.
- **Fix sketch**: Align the cap with the prompt (~1,800 chars) and truncate at the last sentence/word boundary before the cap (ellipsis only as a last resort) in both `_coerce` and the deterministic builder; add an over-length payload assertion to `tests/test_interview_scenario.py` alongside the existing scenario contract tests.
