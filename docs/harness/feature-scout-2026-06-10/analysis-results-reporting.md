# Feature Scout — Analysis Results & Reporting (2026-06-10, re-scan of mined context)

> Total: 4 (2H/1M/1L)
> Prior scan 2026-06-08: 6 findings, backlog retired. This re-scan reports only net-new gaps.

## 1. Persist the GitHub deep-dive with the saved analysis so history reopens the full report
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/api/github-analysis/route.ts:199` (returns the validated payload, persists nothing), `app/features/sub_analyze/useAnalyzeForm.ts:303` (held only in client state), `app/history/[slug]/page.tsx:79` (ResultPanel rendered without `github`), `app/_lib/analyze-run.ts:194` (`persistAnalysis` saves only the Analysis payload), `app/_components/results/ResultPanel.tsx:157`
- **Gap**: The GitHub deep-dive (GitHub REST evidence + a paid Gemini repo-signal code review) lives only in the Analyze tab's React state. `saveAnalysis` never stores it, the history detail page never passes `github` to ResultPanel, and the GitHub profile itself isn't saved either — so the tab can't even be re-run from history. Net-new seam sharpened by shipped RES1: the "Copy report link" a recruiter shares reopens a report missing the GitHub tab the sender was looking at, and the printed PDF omits it too. (Not mentioned in the prior scan's report or the ui-bug-scan.)
- **Proposal**: Extend the hand-written `analysisSchema` (`app/_lib/schemas.ts:69`) with `github: githubAnalysisSchema.optional()` (zod ignores the unknown key in old payloads, so history stays backward-compatible). When the client-side deep-dive completes for a persisted run, attach it via a small `PATCH /api/analyses/[slug]` body (`{ github }`, validated by `githubAnalysisSchema`) — the PATCH route already exists for RES5. History page then passes `parsed.data.github` into ResultPanel's existing `github` prop. Depends on the saved slug being known client-side; `runAnalyze` already returns `persistence: { slug }` — the Analyze-tab threading of that slug is the documented CV1 deferral (cv-analysis scout's territory), so this can ship history-side-first behind it.
- **Why users need it**: For engineering candidates the GitHub evidence tab is half the hiring case; today it evaporates on navigation and every shared/printed/reopened report silently understates the candidate.

## 2. Extend the bilingual catalog to the report surface (results tabs + history detail)
- **Value**: High
- **Category**: user_benefit
- **Effort**: M
- **Where**: `app/_components/results/ResultPanel.tsx:46-52` (hardcoded tab labels "Extraction/Compare/Job fit/Salary/Interview"), `app/_components/results/ReportActions.tsx:30,37`, `DispositionEditor.tsx`, `AddToPipelineButton.tsx:53`, all five tab components + `ScoreDial`/`FactorChart`/`Meter`/`DisclosureRow`, `app/history/[slug]/page.tsx:55-61` ("History ·", "score", "saved" + both error panels), `eslint.config.mjs` (enforcement globs), `messages/{en,cs}.json`
- **Gap**: Opened by i18n commit 7922fbe (2026-06-09): every workspace tab and candidate page was migrated, but `app/_components/results/**` and `app/history/[slug]/page.tsx` were skipped — they're absent from the commit, have zero `useTranslations` callers (verified by grep: only AiDisclosure/voice/LanguageSwitcher under `_components` are migrated), are excluded from the `i18next/no-literal-string` ERROR globs, and `messages/en.json` has no report namespace. Inverted result: the LLM narrative inside the report IS generated in Czech (`--lang` threading), framed by English-only chrome — so the report a Czech recruiter prints via RES1 is a mixed-language artifact. Bonus sub-gap: the analyses table stores no `lang`, so history can't show which language a saved report was generated in.
- **Proposal**: Add a `report` namespace to the catalog covering the results components and history detail page (server page uses `getTranslations`); flip the eslint glob on for `app/_components/results/**` and `app/history/**` to lock it. Stamp `lang` on `saveAnalysis` (idempotent ALTER, same pattern as `disposition`) and show a small en/cs badge on history rows. Coordinate timing: the uncommitted `wip/results-panel-refactor` branch (which predates i18n) rewrites these same files — land this after that refactor merges to avoid a double conflict.
- **Why users need it**: The candidate report is the artifact recruiters print and hand to (Czech) hiring managers; it's now the only major surface that breaks the app's "full bilingual coverage" promise.

## 3. Filter history by disposition
- **Value**: Medium
- **Category**: functionality
- **Effort**: S
- **Where**: `app/features/sub_history/HistoryTab.tsx:47-49` (filter state: q/roleFamily/seniority only) vs `:190-202` (disposition pill rendered per row)
- **Gap**: New seam from two prior findings shipping in separate waves: RES3's filter bar (W4) predates RES5's disposition column (W5), so the recorded decision — the strongest triage signal on the table — renders as a pill but isn't filterable. Not a re-warm: disposition didn't exist when RES3 was scoped (its proposal listed family/seniority/JD/score only), and the W5 close-out left no follow-up to add it to the bar.
- **Proposal**: Add a disposition select (Any / Advance / Hold / Pass / Undecided) to the existing filter bar, filtering the loaded set client-side exactly like roleFamily/seniority; "Undecided" matches `disposition == null`. Reuses `DISPOSITION_STYLE` labels via the existing `dispLabel` helper; no server change (rows already carry `disposition`).
- **Why users need it**: "Show me everyone still on hold for this role family" is the disposition feature's whole payoff at review time; today recruiters scan pills row by row.

## 4. Carry the detected archetype into the report's Add-to-pipeline ref
- **Value**: Low
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/history/[slug]/page.tsx:90` (`archetype: null` hardcoded in `pipelineRef`) despite `app/_components/results/ArchetypeBanner.tsx:38-41` rendering `analysis.v2Profile.archetype` (+confidence) on the same page; `app/_components/results/AddToPipelineButton.tsx:12` (`PipelineRef` already accepts `archetype`)
- **Gap**: New seam from RES2 (W1) intersecting later archetype-driven features: a candidate added from the report enters the pipeline archetype-less even when the report's banner literally announces "Detected archetype: X". Downstream, `entry.archetype` now selects the human-scorecard rubric (`rubricForArchetype`, PREP1/W10) and feeds the screening wave's unknown-archetype audit path (W8) — so the null has acquired real cost since RES2 shipped.
- **Proposal**: On the history page, read `parsed.data.v2Profile?.archetype` (string-guard the best-effort `Record<string, unknown>`, mirroring ArchetypeBanner's narrowing) and pass it in `pipelineRef` instead of `null`. Optionally gate on `archetypeConfidence` above a floor so a low-confidence guess doesn't masquerade as a classification.
- **Why users need it**: Report-sourced candidates get the right interview rubric and don't trip the screening wave's unknown-archetype audit marker — one line of threading instead of a recruiter re-classifying by hand.

---
## Cross-checks performed
- Read prior report `feature-scout-2026-06-08/analysis-results-reporting.md`, `INDEX.md` (retired-backlog banner), `harness-learnings.md`, and `ui-bug-scan-2026-06-08/analysis-results-reporting.md` (grep: no github/persistence finding there).
- **RES4 status check (per brief)**: NOT shipped — `buildComparison`'s only caller is `app/_lib/analyze-run.ts:176` (single multi-variant run); no `/history/compare`, no row-select in HistoryTab. Note: RES4 is also absent from the INDEX's Med/Low roll-up list (same silently-dropped class W10's miscount lesson warns about). Backlog is retired, so it stays archived — explicitly NOT re-proposed here.
- Confirmed shipped (not re-proposed): RES1 `ReportActions.tsx` (copy link + print), RES2 `AddToPipelineButton` wired on history page, RES3 filter bar in `HistoryTab.tsx`, RES5 `DispositionEditor` + `PATCH /api/analyses/[slug]` + pill column, RES6 ListBlock copy (export-utils W3).
- i18n commit 7922fbe inspected via `git show --stat`: no `app/_components/results/*` or `app/history/*` files; eslint i18n ERROR globs listed (results/history dirs absent); `messages/en.json` top-level namespaces enumerated (no report/results namespace; the `"results"` key at :1144 is nested under `match`); grep `useTranslations|getTranslations` over `app/_components` (5 files, none in results/). LLM-narrative localization confirmed already shipped (`AnalyzeParams.lang`, `--lang`, lang in cache key) — a "generate the report in the recruiter's language" finding was killed by this check.
- GitHub seam: read `api/github-analysis/route.ts` end-to-end (no persistence), `analyze-run.ts` (`persistAnalysis` payload only; returns `persistence.slug`), `useAnalyzeForm.ts` (client-state only), `db.ts` `saveAnalysis`/`analyses` schema (no github/lang columns), `schemas.ts` (`analysisSchema` lacks a github field; `githubAnalysisSchema` exists to validate a PATCH).
- Dedup vs other scouts this run: soft_signals.py / sanityChecks (scoring-engine scout) — not touched; Analyze-tab `saved_slug` threading (CV1 deferral, cv-analysis scout) — referenced only as a dependency of finding 1, not claimed.
- WIP branch `wip/results-panel-refactor` diffed vs main: predates i18n, rewrites results chrome — finding 2 carries an explicit land-after note; no chrome-refactor work proposed.
