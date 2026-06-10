# Feature Scout — GitHub Code Analysis (2026-06-10)

> Total: 6 (3H/2M/1L)

## 1. Persist the GitHub analysis with the saved run and show it on the history report
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/features/sub_analyze/useAnalyzeForm.ts:57` (+ `app/history/[slug]/page.tsx:79`, `app/_lib/db.ts`, `app/_components/results/ResultPanel.tsx:27`)
- **Gap**: The validated `GithubAnalysis` lives only in client React state — `db.ts` has zero GitHub columns (grep: 0 matches), the history page renders `ResultPanel` with `analysis` + `pipelineRef` but no `github` prop, and the refresh-resume path (`sessionStorage` ANALYZE_TASK_KEY) restores the main analysis but not the GitHub deep-dive. Every saved/shared report (RES1's copy-link/print on `/history/<slug>`) silently loses the entire GitHub tab the recruiter saw moments earlier.
- **Proposal**: Add a nullable `github_json` column to `analyses` (the established idempotent ALTER pattern), written via a small `PATCH /api/analyses/[slug]` extension (the route already exists for dispositions) once the client has both the saved slug and a `done` GitHub result. History page parses it with `githubAnalysisSchema.safeParse` and passes `github={status:"done", analysis, ...}` to `ResultPanel`. Resume-after-refresh gets the result back for free once it's keyed to the slug.
- **Why users need it**: Recruiters compare and revisit candidates from history days later; today the corroborating GitHub evidence evaporates the moment the tab closes, and the shareable report (already shipped) excludes it entirely.

## 2. Attach the GitHub assessment to the pipeline entry at add-to-pipeline
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where**: `app/_components/results/AddToPipelineButton.tsx` (+ `app/_lib/useAddToPipeline.ts` `pipelineAddBody`, `app/features/sub_pipeline/CandidateDrawer.tsx`, `app/_lib/analyze-run.ts:69`)
- **Gap**: The GitHub assessment is a dead-end display: it feeds no downstream signal anywhere. `analyze-run.ts` hardcodes `github_present: false` (the Python pipeline never sees it), pipeline entries carry nothing GitHub-shaped, and the drawer / Decisions queue / scorecards are all blind to "Evidenced Skills vs Unverified Claims" — the single most decision-relevant output of the panel.
- **Proposal**: When `ResultPanel` has a `done` GitHub result and the recruiter clicks Add to pipeline, fold a compact summary (username, profileUrl, confirmedSkills, unverifiedClaims, hiddenStrengths, top-3 repo links) into the entry — either a small migrated `github_json` on `pipeline_entries` or the existing event `detail` plumbing — and render a "GitHub evidence" section in `CandidateDrawer` beside the AI interview outcome. Depends naturally on #1 for the history-page add path.
- **Why users need it**: The drawer and Decisions tab are where advance/reject happens; corroborated-vs-claimed skills is exactly the evidence a recruiter wants at that moment, and today it only exists on a transient Analyze-tab view.

## 3. Allow a GitHub-only deep-dive (no CV required)
- **Value**: High
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/features/sub_analyze/useAnalyzeForm.ts:275` (+ `app/features/sub_analyze/AnalyzeForm.tsx:179`, `app/features/sub_analyze/AnalyzeTab.tsx:48`)
- **Gap**: `submit()` hard-returns when `cvFiles.length === 0` and the Analyze button is disabled, so the GitHub deep-dive can only ever run as a side effect of a full CV analysis — yet `/api/github-analysis` needs nothing but `profile` + optional `jobDescriptionText`. A recruiter holding just a handle (sourcing lead, referral, conference contact) cannot use the feature at all.
- **Proposal**: When a GitHub profile is filled and no CV is attached, let submit run `executeGithubAnalysis` alone (skip `executeAnalysis`/task submission) and render the `GithubAnalysisPanel` standalone in the result area with the JD threaded as today. Button enablement becomes `cvFiles.length > 0 || hasGithub`; copy on the empty state explains the lighter run. Pure client form-gating — the route, schema, and panel need zero changes.
- **Why users need it**: "Paste a handle, get an assessment" is the natural first sourcing move; forcing a CV upload to unlock an independent, already-non-blocking analysis is an artificial gate.

## 4. One-click GitHub profile assessment of a dev-case submitter
- **Value**: Medium
- **Category**: feature
- **Effort**: S
- **Where**: `app/features/sub_dev/SubmissionRow.tsx:91` (+ `app/_lib/repo-snapshot.ts:33` `parseRepoRef`, `app/api/github-analysis/route.ts`, `app/_components/GithubAnalysisPanel.tsx`)
- **Gap**: Dev-case evaluation analyzes only the submission repo (`fetchRepoSignals` → reflect/tooling/evaluate); the submitter's broader public profile is never assessed, even though `parseRepoRef(sub.repoRef).owner` IS their username and the analyzer route + panel are fully built. The recruiter's workaround today is copy-the-owner into the Analyze tab — which then also demands a CV (#3).
- **Proposal**: Add an "Assess author's GitHub" action on `SubmissionRow`/`CaseDetail` that derives the owner from `repoRef`, POSTs `/api/github-analysis` with the posting's JD text (role spec → JD body already exists on the posting path), and renders the result in the existing self-contained `GithubAnalysisPanel` inside an expandable section or modal. The route's JD-fit signals then read against the actual role being hired for.
- **Why users need it**: A take-home tells you how they did this task; the profile tells you whether the skill pattern is durable. Both halves exist in the codebase — they're just never joined on the one surface where a real candidate repo is in hand.

## 5. Cache the GitHub deep-dive and add a panel-level re-run
- **Value**: Medium
- **Category**: functionality
- **Effort**: S
- **Where**: `app/api/github-analysis/route.ts:238` (+ `app/api/matrix/route.ts` cache precedent, `app/_components/GithubAnalysisPanel.tsx:53`)
- **Gap**: Every run fires up to ~31 GitHub REST calls (user + repos + 20 language maps + 3×3 deep-review bundle) plus one Gemini call, all with `revalidate: 0` and no server-side cache — two analyses of the same candidate within an hour can rate-limit the second (anonymous cap 60/hr). And when the run fails transiently ("Try again shortly"), the ONLY retry is re-submitting the whole CV analysis.
- **Proposal**: Add an in-process TTL cache keyed on `sha1(username + jobDescriptionText)` mirroring the matrix route's content-hash cache (same single-process caveat already accepted there), serving a cached payload with its original `analyzedAt`. On the panel's error state, add a "Retry GitHub analysis" button that re-invokes `executeGithubAnalysis` alone (the run-id supersede plumbing in `useAnalyzeForm` already supports an independent re-fire).
- **Why users need it**: Rate-limit failures are the route's dominant real-world failure mode (the code comments say so); recruiters shouldn't burn a 30-call budget — or re-run a whole CV pipeline — to recover from one.

## 6. Verify profile-builder evidence links against the live repo
- **Value**: Low
- **Category**: feature
- **Effort**: M
- **Where**: `app/features/sub_profile/ProfileTypes.ts:35` (+ `app/features/sub_profile/ProfileEvidenceColumn.tsx`, `app/_lib/repo-snapshot.ts:59`)
- **Gap**: Evidence rows in the profile builder carry a `link` field that flows into the matchable profile, but a pasted GitHub URL is pure decoration — nothing confirms the repo exists, is non-empty, or corroborates the claimed skills, even though `buildRepoSnapshot` (languages, LOC, commit summaries, README) is one import away and evidence provenance directly weights matching.
- **Proposal**: For evidence rows whose `link` parses via `parseRepoRef`, offer a "Verify" action (new thin `POST /api/repo-verify` wrapping `buildRepoSnapshot`) that badges the row with language mix / last-activity / approximate size, and flags an unreachable or empty repo. Optionally suggest the detected languages as skills for that evidence item.
- **Why users need it**: Project evidence is the highest-leverage signal for student/switcher archetypes; one click turning a claimed link into a checked fact raises trust in exactly the profiles the matcher weights on evidence.

---
## Cross-checks performed
- Read all 4 context files in full plus callers: `runAnalysis.ts` (`executeGithubAnalysis`), `useAnalyzeForm.ts` (submit/cancel/reset/resume flow), `AnalyzeTab.tsx`, `AnalyzeForm.tsx`, `ResultPanel.tsx`, `app/history/[slug]/page.tsx`, `github-evidence.ts`, `devcase-run.ts` (snapshot/signals callers), `pipeline/jobfit/devcase/source.py`, `profile.py` (EVIDENCE_KINDS/provenance), `ProfileTypes.ts`/`ProfileEvidenceColumn.tsx`, `SubmissionRow.tsx`.
- Dedup vs `docs/harness/ui-bug-scan-2026-06-08/github-code-analysis.md`: all 4 findings (parseRepoRef traversal, empty-evidence-to-Gemini, Invalid Date, repos array guard) verified FIXED in current code — none re-proposed. "cancel-leaves-github" fix confirmed present in `useAnalyzeForm.cancel()` (githubRunIdRef supersede); "JD-blind-submit" warning confirmed in `executeGithubAnalysis` — not re-proposed.
- Dedup vs `docs/harness/feature-scout-2026-06-08/INDEX.md` (retired backlog): no GitHub-analysis context existed there. Adjacent items checked: CV1/RES2 add-to-pipeline (shipped — my #2 enriches the payload, doesn't re-add the button), CV4 re-analyze-a-saved-run (archived, main-analysis-scoped — my #5 is GitHub-side only), RES1 share/print (shipped — my #1 is what makes GitHub appear in it).
- `Grep "GithubAnalysisPanel"` across all .tsx → single mount in `ResultPanel.tsx:158`; `github` prop passed ONLY by `AnalyzeTab.tsx` (history page confirmed not passing it).
- `Grep -i "github"` in `app/_lib/db.ts` → 0 matches (nothing persisted); in `apply-intake.ts` → 0 matches (apply flow collects no GitHub handle); `analyze-run.ts:69` hardcodes `github_present: false` (Python pipeline never receives it).
- `Grep "useTranslations"` in `app/_components/results/` → 0 files; the whole results subtree is intentionally untranslated (English LLM output), so the panel's hardcoded strings are consistent, not an i18n gap — not proposed.
- Confirmed no existing cache: every `githubFetch`/`gh` call uses `next: { revalidate: 0 }`; matrix-route content-hash cache cited as the in-repo precedent (harness-learnings 2026-06-07 run #3).
