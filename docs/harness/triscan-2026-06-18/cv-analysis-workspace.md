# CV Analysis Workspace — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 3 bug / 1 ui / 1 biz

## 1. Saved-analysis "on board" link and disposition echo cross workspace boundaries
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Multi-tenancy / data leak
- **Value**: impact 9/10 · effort 3/10 · risk 3/10
- **File**: `app/history/[slug]/page.tsx:77`, `app/api/analyses/[slug]/route.ts:88`, `app/_lib/db/pipeline.ts:562`
- **Scenario**: Workspace A and Workspace B both have a candidate named "John Smith" on their boards. A recruiter in A opens a saved analysis report; the "on board" chip resolves and links straight into B's pipeline. When A then records a disposition, `recordAnalysisDispositionEvents` writes a `disposition_set` event onto B's pipeline entry.
- **Root cause**: `findActiveEntriesByCandidateLabel` (pipeline.ts:562) and `recordAnalysisDispositionEvents` (597) match purely on `LOWER(TRIM(candidate_label))` with no `workspace_id` filter and take no workspace argument — even though the analysis row itself is correctly workspace-scoped everywhere else (loadAnalysis, listAnalyses, setAnalysisDisposition all pass `workspaceId`). Both callers in this context invoke them without a tenant.
- **Impact**: Cross-tenant read (chip exposes another workspace's job title + stage + board link) and cross-tenant write (decision events stamped on a stranger's candidate). Silent — neither side sees an error. In a recruiting SaaS this is a confidentiality breach, not a glitch.
- **Fix sketch**: Add a `workspaceId` param to both functions, add `AND workspace_id = ?` to the SELECT in `findActiveEntriesByCandidateLabel`, and thread `currentWorkspace()` (already awaited in both callers — `ws` in the PATCH route, the `currentWorkspace()` used for `loadAnalysis` on the page) through. Same fix pattern as every other scoped query in `db/analyses.ts`.

## 2. Every analyze submit burns an AI-candidate unit even on failure, cancel, or duplicate
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Billing / metering
- **Value**: impact 8/10 · effort 4/10 · risk 4/10
- **File**: `app/api/analyze/route.ts:122`
- **Scenario**: A recruiter uploads a CV; the Python pipeline errors (engine down, bad PDF, non-JSON output) or they hit Cancel two seconds in, or they accidentally double-click Analyze. Each attempt has already decremented their monthly `ai_candidates` allowance.
- **Root cause**: `recordMeterUsage("ai_candidates")` fires synchronously in the POST handler the moment the task is queued — before the run succeeds, and with no refund on the failed/canceled/interrupted terminal states that `runOne` (tasks.ts:256-265) records. The dedupe key for analyze is `analyze:${baseDir}` and `baseDir` is freshly minted per request (`createWorkdir()`), so resubmitting the same CV never coalesces — it bills again. The route comment frames "a failed run burns the unit" as an intentional v1 stance, but cancel-before-work and accidental double-submit are not "work done."
- **Impact**: Paying users lose quota for runs that produced nothing; on the free plan a couple of failed PDFs can lock them out of the headline feature. Direct trust + revenue-credibility hit.
- **Fix sketch**: Move the debit to the point of a successful persisted result (inside `runAnalyze`/`runOne` on `succeeded`), or record on submit but credit back (`grantBillingCredits` +1) on the `failed`/`canceled`/`interrupted` branches in `runOne`. Either keeps the meter honest about delivered analyses.

## 3. Pasted JD / company text bypasses the 8 MB upload contract entirely
- **Lens**: 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Trust-boundary validation
- **File**: `app/api/analyze/route.ts:34-37`, `app/features/sub_analyze/AnalyzePasteRow.tsx:34`
- **Scenario**: A user pastes (or scripts a POST with) a 50 MB blob into the Job description / Company paste box. The carefully-paired client+server file gate (`acceptUpload` / `validateUploadServer`, MAX_FILE_BYTES = 8 MB) never sees it because it only inspects `File` entries.
- **Root cause**: `jobDescriptionText` / `companyText` are read as raw form strings with no length bound — the `<textarea>` has no `maxLength` and the route applies no character/byte cap. The route only spills text over 8 KB to a workdir file (ARGV_TEXT_LIMIT) to dodge E2BIG; there is no upper ceiling, so an arbitrarily large paste is happily persisted and fed to the pipeline.
- **Impact**: Unbounded memory/disk on the server, oversized LLM input (cost + latency), and an asymmetry where the same content is rejected as an 8 MB file but accepted as 50 MB of pasted text. Adversarial-input and DoS surface on a public-ish intake.
- **Fix sketch**: Add a single `MAX_PASTE_BYTES` (e.g. equal to MAX_FILE_BYTES) in `upload-constraints.ts`; enforce it server-side in the route for both text fields (413/400) and set `maxLength` on the paste textarea so the client gates first, mirroring the file contract.

## 4. History tab load error is a permanent dead-end (no retry, no workspace refresh)
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Error recovery / loading state
- **File**: `app/features/sub_history/HistoryTab.tsx:58-76`
- **Scenario**: `GET /api/analyses` blips (SQLITE_BUSY, transient 500) on tab open; the user sees a red "load failed" panel with no way forward but a full page reload. Separately, switching the workspace segmented control unmounts/remounts the tab so it re-fetches — but a stuck error from the prior workspace gives no in-place recovery.
- **Root cause**: The fetch runs once in a mount effect keyed on `t`; on failure it sets `error` and offers no Retry affordance, and there is no manual refresh control. The Analyze form and JD picker are careful about retry/abort, but History has none.
- **Impact**: The saved-runs list — the recruiter's only durable record of past analyses — looks broken on any transient hiccup, eroding trust in a core surface. Cheap, high-frequency annoyance.
- **Fix sketch**: Extract the fetch into a `reload()` callback; render a "Try again" button in the error panel (and optionally a small refresh icon in the header) that re-runs it and clears `error`. Matches the inline-retry pattern already used in the Analyze form.

## 5. No bulk disposition / compare from the saved-runs list — journey dead-ends at one row
- **Lens**: 🚀 Business Visionary
- **Severity**: High
- **Category**: Missing capability / retention
- **File**: `app/features/sub_history/HistoryTab.tsx:197-247`
- **Scenario**: A recruiter has run 30 candidates against the same JD. History lets them search/filter and click into ONE report at a time; to triage they must open each, set advance/hold/pass, back out, repeat. There is no select-multiple, no inline disposition, and no "compare the top N against this JD" from the list — even though the engine already supports best-of-N comparison and per-JD grouping (`listAnalysesByJd`, `buildComparison`).
- **Root cause**: The table is read-only navigation; disposition lives only on the per-analysis detail page (`DispositionEditor`), and comparison is only reachable by uploading variants together in one run, not by assembling already-saved analyses.
- **Impact**: The high-value moment for a paying recruiter — comparing a shortlist for one role — is exactly where the product makes them work hardest, and is a differentiation/retention gap vs. ATS tools that pivot a JD into a ranked shortlist. The data and primitives already exist.
- **Fix sketch**: Add inline advance/hold/pass pills (reuse `setAnalysisDisposition` PATCH) and row checkboxes on the History table; surface a "Compare selected" / "Rank this JD's candidates" action that feeds the existing `buildComparison` view from saved rows. Incremental — no new pipeline work.
