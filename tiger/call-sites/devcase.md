---
id: devcase
type: tiger/call-site
modality: text
file: pipeline/jobfit/devcase/devcase_cli.py:279 (production dispatch — resolve_provider(use_case)); eval harnesses construct ClaudeCliProvider directly (submission_eval.py:468, lifecycle_eval.py:238)
wrapper: resolve_provider (production); direct ClaudeCliProvider (the 3 LLM-judge call sites)
provider: anthropic  model: sonnet (claude-sonnet-4-6) for analyze/role_design/case_design (USE_CASE_MODEL_OVERRIDES capabilities.py:62-67); haiku for reflect/tooling/evaluate/transfer/judge/interview_scenario/seed. NOTE: the sonnet/haiku split only holds if KP_LLM_CONFIG pins anthropic; local-dev default is one CLI model for ALL steps
schema: yes — typed pydantic (models.py CoverProbe/CaseScenario/RoleSpec/CaseEvaluation). BUT validation is asymmetric: per-step coerce()+deterministic() self-repair; the CLI model_validates INPUTS only, never the LLM OUTPUTS
grounding: 2/4 to 4/4, wide range across steps
quality_score: 4  code_score: 4
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[eva-eng-hiring-lead]]", "[[sam-dev-candidate]]"]
---
## What it does
A full LLM-era dev-hiring lifecycle, one family of ten use cases. DESIGN: analyze_need (reflect a need vs the REAL repo snapshot), design_role, design_case (the heart — a ≤2h work-sample that ASSUMES 100% LLM-authored code + 2-4 covert probes with a decisionSpace), materialize_seed (prose → real starter files carrying traps), scenario_from_case (→ AI voice-interview phases). EVALUATION: reflect_commits → assess_tooling → evaluate_submission (five durable capabilities, never correctness) → score_transfer → mint_followups (authorship-verification questions). Three OFFLINE LLM-as-judge harnesses gate fairness/quality in CI. Shared runner: provenance.generate_with_fallback (provenance.py:132) → tri-state source + per-step fallbackReason.

## Prompt & grounding (n reaching / m that should)
- **analyze** (sonnet) 3/3 — need + JD (6k cap) + actual RepoSnapshot(s); "ground every claim", say "ungrounded" when no snapshot. Strong.
- **role_design** (sonnet) 3/3 — need + JD + analysis + 3 comparable seed roles; fights domain-drift.
- **case_design** (sonnet) 3/3 — role + stack + trueComplexity + riskAreas + timebox + CV focus_probes + reviewer feedback. Anti-leakage by construction (case-design-v4, reveals/decisionSpace INTERNAL). Clears Eva's "realistic, no leaked solutions" bar — for the artifact text (see Finding 5).
- **reflect / tooling** (haiku) 2/4, 3/5 — THE grounding gap. The candidate's actual submission (diffs, code, DECISIONS prose) NEVER reaches these prompts; only DURABLE METADATA (commit subjects[:140], counts, cadence, tree). "Did the candidate handle probe X" is inferred from commit-message shape, not the code. Deliberate (durable-signal philosophy), and candidate-authored fields are fenced as untrusted (good injection mitigation).
- **evaluate** (haiku) 2/4 — scores the five capabilities from ONLY reflection+tooling+rubric+role title (evaluate.py:112-117). Does NOT see the case brief, repo, or submission. "Cite the candidate's actual submission" (Eva's bar) structurally **not met** at the model layer — grades a summary of a summary. Confidence propagated as MIN of upstream (good honesty).
- **transfer** (haiku) 3/3 — derives from evaluation + role. Fine.
- **mint_followups** (haiku) 4/4 — strongest grounding: anchors each question to a probe's decisionSpace + observed probeOutcome (evaluate.py:280-289). Salvages the assumed-LLM-authored premise — the live interview verifies ownership.
- **interview_scenario / seed** (haiku) 3/3 — full case incl. internal reveals (kept internal); seed _safe_path sanitizes LLM paths before disk write (injection guard).
- **judge** (haiku, OFFLINE) — gets a truncated JSON dump of eval+transfer; QAs the scorer's OUTPUT, never re-reads the submission.

## Code quality (wrapping · logging · caching)
- Routing: production uniform through resolve_provider with per-command use-case map (devcase_cli.py:51) + a catalog row per step — every step pinnable/meterable. Clean. Gap: outputs never model_validated in the CLI (coerce-to-dict only).
- Schema + self-repair: typed models + per-step coerce/deterministic + mandatory-reveals backfill (design.py:88-93). Strong.
- Telemetry: monitor on the production path → LightTrack fire-and-forget. The 3 JUDGE sites use bare ClaudeCliProvider (NOT MonitoredClaudeCli) → judge spend unmetered (offline, low impact). Ledger: gap.
- **Caching/dedup: none in the Python path.** design/seed/scenario regenerated every invocation; "once per role/case" by intent but nothing enforces it → a re-run re-pays sonnet.
- **maxTokens 2048 (base.py:32) tight for sonnet case_design + seed** (long brief + probes + up to 12×6k files). Truncation → unparseable JSON → silent deterministic fallback (the prose-only seed Sam would receive).
- Prompt-version tags: disciplined everywhere. Provenance: best-in-codebase (tri-state + fallbackReason + propagated confidence + --strict CI gate).

## Findings
1. [value] **HIGH — LLM judge is the SAME engine as the generator (self-grading).** submission_eval.judge (:368/468), lifecycle_audits.judge + audit_role_fit run on a bare ClaudeCliProvider() — the same engine that produced the artifact. For a fairness gate, shared blind spots. Fix: route the judge through resolve_provider("devcase_judge") (catalog row exists, capabilities.py:41) so KP_LLM_CONFIG can pin a *different* model; document a "judge ≠ generator" invariant.
2. [value] **HIGH — the evaluation never sees the actual submission.** evaluate_submission fed only inferred reflection+tooling (evaluate.py:112-117), themselves from commit *metadata*. materialize_seed makes the submission a reviewable diff but it's never threaded into reflect/tooling/evaluate. Scores can be generic — Eva's failure mode. mint_followups is the only specificity rescue, and only at interview time. Fix: thread the materialized-seed diff (key changed-file excerpts, fenced) into assess_tooling/evaluate so a probe outcome cites the file/line.
3. [code] **MED — no response cache/dedup → sonnet re-paid on every re-run.** Fix: key design/seed/scenario on (prompt-version, input-hash) and cache, or memoize within a lifecycle run.
4. [code] **MED — maxTokens=2048 risky for case_design / seed.** Truncation → silent deterministic prose-only seed (the essay-gradeable case the materialize step exists to avoid) while the run reads "deterministic," not "failed." Fix: per-use-case maxTokens defaults.
5. [value] **MED — solution-leakage contained but not validated end-to-end.** Internal reveals/decisionSpace excluded from candidate renders (models.py:216-221) and the seed prompt forbids hints — but no automated check that materialized seed files don't echo a probe's reveals into candidate-visible content. Fix: post-generation scan that fails the seed if any reveals/decisionSpace string appears in files[].contents.
6. [code] **LOW — CLI never validates LLM OUTPUT against pydantic** (inputs only, devcase_cli.py:231). A coerce regression ships a malformed artifact. Fix: final model_validate on the emitted artifact.
7. [code] **LOW — judge spend unmetered** (bare ClaudeCliProvider). Fixed for free by Finding 1.
