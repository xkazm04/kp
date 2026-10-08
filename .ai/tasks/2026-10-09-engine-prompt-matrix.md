# 2026-10-09 — engine and prompt coordination matrix (goal a51b45df)

Charter `accepted-idea-delivery`. Base: `56fd756a3` "docs(tasks): record the 8-worker e2e isolation: before table, seven mechanisms, eight clean runs". Docs only.

## Reconcile
Draft: `eec605ba1` "docs(architecture): one engine/prompt matrix for the whole hiring thread" (branch `goals/engine-matrix-leftover`, 2026-09-14, against `add2fc24b`). Not cherry-picked, branch and worktree untouched.
On the base, `docs/architecture/engine-and-prompt-coordination.md` was absent, and no doc held a step-to-engine or prompt-version table (the grep hits are provider/feature docs and ADR/ship text). Proceeded.

## Row-by-row changes from the draft
Every cell was re-derived at the base and cited `file:line`; no draft value was copied unverified.
- CV analysis: `v6-2026-09-04-engine-kind` -> `v8-2026-10-07-checked-strengths` (`app/_lib/cache-key.ts:36`; pinned at `test_analysis_prompt_version_sync.py:167`). `profile_extract` is no longer a seat (absent from `LLM_USE_CASES`).
- Screening `screening-v3` -> `screening-v4` (`automation.py:93`); `role-design-v4` -> `role-design-v5` (`devcase/design.py:30`). Unchanged: `case-design-v7`, `scorecard-v8`, `match-reasoning-v5`, `offer-v6`, `outreach-v4`, `rejection-v5`, `interview-prep-v3`, `rematch-v2`, `transfer-v2`, `case-eval-v2`, `followups-v3`.
- New rows: group comparison, weight proposal, agent fit, interview kit / feedback letter; the seats added since (job-seeker, gigs, posting_translate, profile_draft, github_analysis) are listed under "Seats outside the hiring thread".
- Routing sections now: default, matching, automation, roles, profiles, interviews, companion, jobseeker, gigs, assignments (draft predated several).
- "Unconfigured engine" now documents the production-Gemini default (`registry.py:80-95,360`) the draft did not.

## The two findings
- (a) three implementations + two exemptions: **partly changed.** Three control-flow paths and the two no-fallback seats still hold. Changed: the reason vocabulary is now shared (`llm/degradation.py`, `4771dcc46` "feat(tests-llm-eval): drill the shared fallback runner with coded descents"), and `generate_with_fallback` also serves agent fit, intake, job-seeker and repo scan, not only the devcase seats.
- (b) `jd_ingest` hard-fails keyless: **still true** (`pipeline/jobfit/jobs_cli.py:48-50`). Open under Known gaps.

## Gates (worktree)
See the result file; recorded there with outcomes.

## Questions (not fixed, docs-only task)
- `weight-proposal-v2` (`pipeline/jobfit/weight_proposal.py:26`) has no reader or stamp anywhere in `pipeline/` or `app/` — decorative constant. Not in the sync test.
- `scripts/docs/feature-doc-map.json`: added one entry only. It overlaps the existing `docs/features/pipeline/README.md` mapping on `automation.py` and `automation-run.ts` (the shape holds several docs per file; `test:docs` passes). No existing mapping was changed. No file was left out.
