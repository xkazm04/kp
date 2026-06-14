> Total: 4 findings (Crit/High/Med/Low: 0/0/3/1)

Scope: the `analysis-results-reporting` context (32 files from `_scan-plan.json`). Read-only; no files modified. All DEAD/UNUSED claims grep-verified repo-wide — none surfaced (every in-scope module/export has live callers), so all findings are SAFE, mechanical **duplication** + one cleanup. (Report reconstructed by orchestrator from subagent reply — subagent write was harness-blocked.)

## 1. Winner-by-primary-score logic duplicated between `comparison.ts` and `CompareTab.tsx`
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/_components/results/compare/CompareTab.tsx:67` (+ `app/_lib/comparison.ts:85-90`)
- **Evidence**: `comparison.ts` defines private `primaryScore(variant)` — `if (variant.jobFitScore != null) return variant.jobFitScore; return variant.score.total;` — used in 4 places (ranking, driver insights, merged-bullet ordering). `CompareTab.tsx:67` re-implements the identical rule inline: `const primary = (v) => (v.jobFitScore != null ? v.jobFitScore : v.score.total);` then loops for `winnerIndex`. Grep (`jobFitScore != null`, repo-wide) returns exactly these two files; `primaryScore` is grep-confirmed private to `comparison.ts`. The lib computes `bestLabel`; the tab computes the highlighted `winnerIndex` — they must encode the same order (the tab even comments that it re-derives by index to dodge a label-collision bug).
- **Impact**: Two definitions of "which variant wins" that can drift; a future tiebreak change made in one place crowns one column while the recommendation names another.
- **Fix sketch**: Export `primaryScore` from `comparison.ts`, import it in `CompareTab.tsx`, drop the inline `primary`. `comparison.ts` already uses `.ts` relative imports + has a colocated `comparison.test.ts`, so import-free purity doesn't apply — exporting one fn is node-test-safe. Only caller to update: `CompareTab.tsx`.

## 2. Score-component descriptor declared three times within this context
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/_components/results/compare/CompareTab.tsx:13-20` (`COMPONENT_ROWS`) + `app/_lib/comparison.ts:9-18` (`COMPONENT_KEYS`/`COMPONENT_LABELS`); canonical list ignored at `app/_lib/format.ts:394` (`SCORE_COMPONENT_KEYS`)
- **Evidence**: `format.ts` exports `SCORE_COMPONENT_KEYS` = the five components, with a colocated test asserting "the canonical five, in render order" (`format.test.ts:201`). Yet `comparison.ts:9` re-declares them as private `COMPONENT_KEYS` (+ a `COMPONENT_LABELS` map), and `CompareTab.tsx:13` re-declares them again as `COMPONENT_ROWS` (`total` + the same five, with its own labels). A pre-existing backlog item `idea-1425ac31-single-source-the-score-compon` names this exact drift (it also pulls in `FactorChart` maxima + `scripts/compare.py`), confirming it's recognized, not speculative.
- **Impact**: Three hand-kept copies of the score taxonomy/labels; reorder/rename one and FactorChart, compare grid, and driver-insight prose drift apart.
- **Fix sketch**: Derive `comparison.ts`'s `COMPONENT_KEYS` and the non-`total` rows of `COMPONENT_ROWS` from `SCORE_COMPONENT_KEYS` (tab imports from `@/app/_lib/format`; `comparison.ts` from `./format.ts`). Co-locate one `{key,label}` map in format.ts so labels share a source. The `total`/`jobFitScore`/`keywordCoverage` extra rows stay local to the tab. Overlaps the broader cross-language backlog idea — scope the TS half here.

## 3. Defensive `parseGithub(github_json)` helper duplicated across the analysis read paths
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/api/analyses/[slug]/route.ts:46-54` + `app/history/[slug]/page.tsx:19-29`
- **Evidence**: Both define a private `parseGithub(githubJson, slug)` guarding a corrupt `analyses.github_json` column: falsy early-return, `JSON.parse` in try/catch, `console.error("...corrupt github_json on...")` on failure. History additionally runs `githubAnalysisSchema.safeParse` and wraps as `ResultPanelGithub`; the API route returns raw `unknown`. Grep (`function parseGithub|github_json`) shows these two plus a third sibling `parseGithubEvidence` in `app/_lib/db/pipeline.ts:245` — that parses a *different* type off pipeline rows and is out of scope, correctly NOT merged. The two in-scope copies share the parse-and-log core, differing only in post-parse wrapping.
- **Impact**: Two copies of the "corrupt column must never 500, log + degrade" contract; a guard fix (size cap, log channel) must be made twice. Both sit on the saved-report render path where degrade-not-crash matters.
- **Fix sketch**: Extract one `parseStoredGithubAnalysis(json, slug): GithubAnalysis | null` (parse + safeParse + log) into a shared lib (e.g. beside `app/_lib/db/analyses.ts`). API route returns it directly; history page wraps the non-null result into `{status:"done", …}`. Update the two in-scope files; leave `parseGithubEvidence` untouched.

## 4. `console.error` is the analysis read path's only error channel — confirm intentional, not stray debug logging
- **Severity**: Low
- **Category**: cleanup
- **File**: `app/api/analyses/route.ts:13`; `app/api/analyses/[slug]/route.ts:41,51,97`; `app/history/[slug]/page.tsx:26,46,83`
- **Evidence**: Every error branch logs via bare `console.error("[api:analyses]…" / "[history]…")`, each paired with a deliberate comment ("Log the full error server-side; return a generic, stable message…") and a graceful fallback — i.e. intentional structured server logs, not leftover `console.log`s. Grep found no stray `console.log`, commented-out blocks, or stale TODOs in this context. The repo has `app/_lib/logger.ts`, so these tagged sites are the consolidation point *if* a structured-logging convention exists.
- **Impact**: Cosmetic / observability consistency only. No behavior bug, no dead code.
- **Fix sketch**: Only if a repo-wide structured-logging convention exists, swap to the shared logger keeping the same `[api:analyses]`/`[history]` prefixes. Otherwise leave as-is — they're correct and well-commented.

### Checked and deliberately NOT flagged (certainty notes)
- `SkillChips.tsx` `escapeRegExp`+`findEvidence`: other grep hits are slugifiers (`apply-intake.ts`, `lead-payload.ts`, `jobs.py`) or a different fuzzy turn-matcher (`InterviewTranscriptModal.findEvidenceTurn`). No true duplicate.
- `SalaryTab.tsx:13` `midpoint * 1.3` vs `SalaryGauge.tsx:25` `?? midpoint * 1.3`: the tab computes the rounded target and passes it in via the `target` prop so card and gauge agree; the gauge's `??` is a documented standalone fallback. Intentional single-source-with-fallback.
- `ListBlock` (shared.tsx:176) vs `SoftSignalsSection` (:34) copy blobs use different formats (markdown bullets vs `[RED FLAG] label — probe` checklist mirroring Python `to_interview_checklist`). Not the same idiom.
- `comparison.ts` is NOT dead: `buildComparison`/`hasRenderableComparison` are imported by `ResultPanel.tsx`, `CompareTab.tsx`, analyze-run.
- `ResultPanel.lgGridClass` / `InterviewTab.tileGridCols` lookup tables are required for Tailwind static-class purge (commented as such) — intentional, not consolidatable.
