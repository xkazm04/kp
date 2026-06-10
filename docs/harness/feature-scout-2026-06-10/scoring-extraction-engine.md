# Feature Scout — Scoring & Extraction Engine (Python) (2026-06-10)

> Total: 6 (3H/2M/1L)

## 1. Surface the soft-signal panel (antipatterns + hidden strengths) on the analysis result
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where**: `pipeline/jobfit/soft_signals.py:311` (`build_soft_signal_panel`), `:60` (`to_interview_checklist`) (+ `pipeline/jobfit/pipeline.py:236` for the wiring seam, `pipeline/jobfit/models.py:183` `AnalysisResult`, `app/_components/results/*`)
- **Gap**: An entire, fully-built, unit-tested module — overclaim-risk, archetype contradictions, evidence thinness, tenure instability, vague-vs-concrete delivery, plus hidden strengths (potential, transferable meta-skills, quantified ownership), each with confidence + a suggested interview probe — has **zero production callers**. Grep confirms the only references are `tests/test_soft_signals.py` and a docstring in `devcase/design.py`; the panel never enters `analyze_cv`, the stdout JSON, or any UI.
- **Proposal**: Wire `build_soft_signal_panel(v2, job_fit)` into `analyze_cv` as another `_softly` add-on (the `CandidateProfileV2` object already exists pre-dump inside `_v2_profile_and_routing`, and `job_fit` is in scope). Add a `soft_signals: SoftSignalPanel | None` field on `AnalysisResult` — `npm run build`'s `schemas:gen` propagates the zod type for free. Render a "Confirm in interview" panel on the results surface (antipattern/strength chips with source + confidence badges, expandable probe text), and offer a one-click "copy checklist" via `to_interview_checklist()` reusing the W3 export toolkit.
- **Why users need it**: This is the product's own stated stance — "a CV yields hypotheses, not verdicts" — and the engine already computes exactly the red-flag/strength hypotheses a recruiter must verify, then throws them away. Recruiters currently re-derive these by eyeballing the raw CV.

## 2. Show the analysis quality flags (sanity checks / repairs) to the recruiter
- **Value**: High
- **Category**: user_benefit
- **Effort**: S
- **Where**: `pipeline/jobfit/pipeline.py:215` (`_sanity_checks` + repairs), `:856-954` (score/salary/archetype checks), `app/_lib/schemas.generated.ts:41` (`sanityChecks: z.array(z.string())`) (+ `app/_components/results/shared.tsx`, history page)
- **Gap**: The pipeline painstakingly builds a per-analysis trust ledger — "Salary range needs manual review", "Score total disagrees with its breakdown", "Local text extraction failed … relying on Gemini", "Interview kit unavailable — insight skipped", reversed-salary repairs — and it ships in every payload and in the zod schema, but **no component renders `sanityChecks`** (grep across `app/`: only the schema and two test fixtures). A degraded analysis is visually identical to a clean one. (Archetype confidence alone is surfaced, via `ArchetypeBanner`.)
- **Proposal**: Add a "Quality & trust" strip to the result panel: split `sanityChecks` into warn lines (contains "manual review" / "failed" / "disagrees" / "missing" / "inconsistent") and ok lines; render warns as an amber callout above the tabs, oks collapsed behind a "view checks" toggle. On the History list, show a small "⚠ N review flags" pill per row (the payload column already carries the array). en+cs strings via next-intl.
- **Why users need it**: Recruiters negotiate salaries and reject candidates off these numbers; the engine already knows when a number is repaired, degraded, or self-contradictory and currently keeps that to itself — a silent success-theater risk.

## 3. Explain the potential score: surface learning signals, transferable meta-skills and domain distance
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where**: `pipeline/jobfit/transform.py:34` (`compute_potential` signals), `:141-169` (`transferable_skills`, `domain_distance` on `MatchCandidate`), `pipeline/jobfit/transferable.py:99` (+ `pipeline/jobfit/matching.py:732-744` candidate block, `pipeline/jobfit/recruiter.py:52-65`, `app/features/sub_jobs/RecruiterCandidates.tsx:247`, `app/features/sub_decisions/GroupEvalModal.tsx:524`)
- **Gap**: For every early-career/switcher candidate the bridge computes human-readable explanations — "2 projects with a demo link", "internship experience", "prior field adjacent to the target — shorter bridge", credited meta-skills like mentoring/stakeholder-management, and a graded `domain_distance` (adjacent|moderate|far). They feed the score math and the LLM reasoning **prompt** (`match_reasoning.py:45-56`) but are never returned to TS: `match()`'s candidate block and `rank_candidates_for_job` rows carry only `potentialScore`, so the UI shows a bare "potential 64%" pill with no why.
- **Proposal**: Add `learningSignals`, `transferableSkills`, `domainDistance` to `match()`'s candidate dict and the recruiter row dict (data already on the `MatchCandidate`, no recompute). In the UI, make the potential pill expandable/tooltipped: list the signals, render transferable skills as provenance-badged chips (they're credited at professional grade — `provLabel` exists), and show a one-word bridge label for switchers in RecruiterCandidates, Match results header, and GroupEvalModal.
- **Why users need it**: Archetype-fair scoring is the engine's differentiator, but an unexplained 0-100 "potential" invites distrust and overrides; the explanations exist and showing them is what makes the fairness auditable in screening discussions.

## 4. Drive the analyze stage strip with the engine's real per-stage progress
- **Value**: Medium
- **Category**: functionality
- **Effort**: M
- **Where**: `pipeline/jobfit/cli.py:11-17,40-49` (`--stream` SSE stage events), `app/features/sub_analyze/AnalyzeApi.ts:35-51` (soft-timeline fake) (+ `app/_lib/analyze-run.ts:40-49` `cliArgs` builds no `--stream`, `app/_lib/tasks.ts` `setTaskProgress`)
- **Gap**: The CLI already emits real SSE progress events (`{"type":"stage","stage":"extract|gemini|profile|scoring|salary|insights","status":...}`) — the byte-mode writer was even hardened for Windows CRLF specifically so "the Next.js route" could parse it — but **no TS caller passes `--stream`**; `runAnalyze` waits for one final JSON dump while `AnalyzeApi.ts` animates the stage strip on a timer ("the pipeline emits one final result" — no longer true). Bug-hunt CV#7 deferred the decorative strip for exactly this missing feed.
- **Proposal**: Spawn the analyze CLI with `--stream`, parse `data:`-framed lines incrementally off stdout in `runAnalyze`, forward stage events through the existing task-progress channel (`setTaskProgress` message, e.g. `stage:gemini:active`), and have the poll loop in `useAnalyzeForm` map them onto `applyStageEvent` instead of the soft timeline. The `result` event replaces the final-stdout parse; keep `parsePythonJson` semantics for the embedded payload.
- **Why users need it**: A 60-90s LLM run with fake progress misleads on where time goes and makes a hang indistinguishable from a slow Gemini call; real stages also make "cancel" decisions informed (don't kill a run that's already past the paid Gemini stage). Distinct from retired CV5 (time-based estimates) — this consumes events that already exist.

## 5. Thread CV soft-signal probe briefs into the dev-case designer
- **Value**: Medium
- **Category**: feature
- **Effort**: M
- **Where**: `pipeline/jobfit/soft_signals.py:291` (`panel_to_probe_briefs`), `pipeline/jobfit/devcase/design.py:186,249,291` (`focus_probes` parameter) (+ `pipeline/jobfit/devcase/devcase_cli.py:351` — the production `design_case` call passes no probes)
- **Gap**: The "Rec B bridge" — turning a candidate's unconfirmed antipatterns into targeted covert probes baked into their work-sample — is implemented and tested **end to end on the Python side** (`panel_to_probe_briefs` → `design_case(focus_probes=…)` reserves probe slots for the briefs), but the only production `design_case` caller (`devcase_cli.py:351`) never passes `focus_probes`, so every dev-case is designed candidate-blind.
- **Proposal**: After #1 persists the panel on the analysis, add an optional `--focus-probes-json` (or candidate-ref) argument to `devcase_cli`'s design step that loads the candidate's panel, calls `panel_to_probe_briefs`, and forwards it. On the TS side, when a dev-case is generated for a candidate with a saved analysis, pass the briefs through `devcase-run.ts`. Show "probing: <focus>" tags on the generated case so the recruiter knows what the trap targets.
- **Why users need it**: It closes the loop the module was written for — an overclaimed "strong Kubernetes" on the CV becomes a verification trap in that candidate's actual work-sample instead of a generic case, which is materially better screening signal per case generated.

## 6. Localize the grounded market-salary summary (forward `--lang` from the JD builder)
- **Value**: Low
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/_lib/jd-build-run.ts:40` (spawn without `--lang`) (+ `pipeline/jobfit/market_salary_cli.py:73` `--lang` flag, `:99` prompt line, `app/features/sub_library/JdBuilderResult.tsx`)
- **Gap**: `market_salary_cli` already accepts `--lang` and instructs Gemini to write the market summary in that language, but its only TS caller spawns it without the flag — so since the bilingual i18n landed (commit 7922fbe), a cs-locale recruiter builds a JD whose "About the role" paragraph embeds an English market summary (`composeMarkdown` interpolates `s.summary` straight into the published Markdown).
- **Proposal**: Thread the request locale into the jd_build task params (same capture-at-request-time pattern `analyze-run.ts:27` documents for its `lang`) and append `"--lang", lang` in `runMarketSalary`. Verify the deterministic fallback summary string too (it is currently English-only in `_fallback`; either localize it Python-side via the existing `i18n.language_name` helpers or map it client-side).
- **Why users need it**: The JD builder output is candidate-facing published text; a mixed-language JD looks broken to Czech applicants and undercuts the just-shipped full bilingual experience.

---
## Cross-checks performed
- Read all 21 context files plus consumers: `app/_lib/analyze-run.ts`, `jd-build-run.ts`, `match-candidate.ts`, `app/_components/results/{ExtractionTab,JobFitTab,ArchetypeBanner}.tsx`, `app/features/sub_analyze/*`, `app/features/sub_match/MatchTypes.ts`, `pipeline/jobfit/{matching,recruiter,transform,transferable}.py` excerpts.
- Dedup: read `docs/harness/feature-scout-2026-06-08/INDEX.md` (60-item retired backlog) + `harness-learnings.md`. None of the 6 items above collide with shipped waves (MAT1-6, CV1-6, RES, PREP, DEC, VOX all checked) or the retired Med/Low list. #4 is deliberately distinct from retired CV5 (time-aware estimates) and resolves the root cause of the bug-hunt CV#7 deferral; noted in the entry.
- Soft signals dark: `grep build_soft_signal_panel|panel_to_probe_briefs|SoftSignalPanel` repo-wide → only `soft_signals.py`, its tests, and a `devcase/design.py` docstring. No route/CLI/`pipeline.py` caller.
- `sanityChecks` dark: `grep -i sanity|sanityChecks` in `app/` → only `schemas.generated.ts:41` + two test fixtures; no component renders it. Confirmed `ExtractionTab` renders evidenceTrace/extractionQuality/extractionComparison and `JobFitTab` consumes keywordCoverage incl. the `*_total` "+N more" caps (so those are NOT dark — excluded).
- Potential explainability: `grep transferable|domainDistance|learningSignals|potentialScore` in `app/` → UI renders only `potentialScore` (RecruiterCandidates:247, GroupEvalModal:524,872); `matching.py:732-744` and `recruiter.py:52-65` confirm the signal lists never leave Python except into the `match_reasoning.py:45-56` LLM prompt.
- `--stream` unused: `grep "--stream"` in `app/` → no matches; `cliArgs` (analyze-run.ts:40) never appends it; `AnalyzeApi.ts:35-36` comment confirms the strip animates on a soft timeline.
- `--lang` gap: `market_salary_cli.py:73` defines the flag; `jd-build-run.ts:40` spawn omits it (analyze-run.ts:43 DOES forward lang, so the analysis path is fine — only the JD-builder path is dark).
- `design_case` production callers: `devcase_cli.py:351`, `lifecycle_eval.py:121` — neither passes `focus_probes`; only `test_soft_signals.py:128` does.
- ArchetypeBanner already surfaces archetype confidence/reasons/completeness gaps — so archetype-routing visibility was NOT re-proposed; #2 covers only the un-surfaced remainder of `sanity_checks`.
