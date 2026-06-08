# Feature Scout — CV Analysis Workspace (kp)

> Total: 6 opportunities (High: 3, Medium: 2, Low: 1)
> Files read: ~16

## 1. "Add to pipeline" from the analysis result
- **Value**: High
- **Category**: integration
- **Effort**: M
- **Where it slots in**: `app/_components/results/ResultPanel.tsx:111` — the result header, beside the tab row, where a finished `Analysis` lands
- **Gap**: After a run completes the recruiter sits on a rich result (score, archetype, role family) and a persisted slug — but there is no action to move that candidate forward. `app/api/pipeline/route.ts:15` already accepts a POST of exactly `{ candidateId, candidateLabel, archetype, roleFamily, jobId, jobTitle, matchScore, stage }`, yet nothing in the Analyze workflow ever calls it. The journey dead-ends at "read the report"; the recruiter must hand-create the pipeline entry elsewhere.
- **Opportunity**: An "Add to pipeline" button on the result that pre-fills the POST body from the analysis (`analysis.score.total`, `analysis.candidate.roleFamily`, `analysis.v2Profile` archetype, the persisted candidate label/slug) plus a job picker, and stages the candidate at "Screened".
- **Why it matters**: Closes the loop between the intake surface and the kanban — the single highest-leverage step in turning an analysis into actual recruiting work.
- **Sketch**: New `AddToPipelineButton` in `ResultPanel.tsx`; reuse the `persistence.slug` returned by `analyze-run.ts:165`; POST to `/api/pipeline`; show a toast + link to `sub_pipeline`.

## 2. Paste CV text directly (no file required)
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/features/sub_analyze/AnalyzeProfileInput.tsx:88` — the CV column, which is upload-only
- **Gap**: The CV is the one *required* input and the only one with no paste path. Job description (`AnalyzeForm.tsx:93`) and Company overview (`AnalyzeForm.tsx:123`) both expose an `AnalyzePasteRow`, but a recruiter who copied a candidate's profile out of an email or LinkedIn must first save it as a file to analyze it. The server already supports CV-as-text downstream — `analyze-run.ts:38` builds `--job-description-text`/`--company-text` CLI flags, so a `--cv-text` style path is a natural sibling.
- **Opportunity**: Add a "Paste CV" tab/row to the CV column that wraps pasted text into a `text/plain` File (the same trick `loadSample` uses at `AnalyzeProfileInput.tsx:76`) before handing it to `addCvFile`, so the whole pipeline stays unchanged.
- **Why it matters**: Removes the single biggest friction in the primary intake flow — copy-paste is how recruiters actually move candidate text around.
- **Sketch**: Reuse `AnalyzePasteRow`; on submit, `new File([text], "pasted-cv.txt", {type:"text/plain"})` → `handlers.addCvFile`; no server change needed (already a valid TXT upload).

## 3. Save the typed JD to the library inline
- **Value**: High
- **Category**: automation
- **Effort**: S
- **Where it slots in**: `app/features/sub_analyze/AnalyzeForm.tsx:92` — the JD column, below the paste row
- **Gap**: The form can *read* saved JDs (`useAnalyzeJdLibrary.ts:18` lists `/api/jds`, the picker at `AnalyzeSavedJdPicker.tsx` loads one) but offers no way to *write* one. A recruiter who pastes a fresh JD here and wants to reuse it is told to leave for `/?tab=library` (`AnalyzeSavedJdPicker.tsx:24`). The save round-trips the user out of their intake mid-task.
- **Opportunity**: A "Save to library" affordance on the JD column that POSTs the current `jobDescriptionText` (+ a title) to the JDs API, then auto-selects the new slug so the run records `jdSlug` (which `analyze-run.ts:156` already persists for history linkage).
- **Why it matters**: Turns a one-off paste into reusable inventory without breaking the recruiter's flow, and makes more runs carry a `jdSlug` for cleaner history.
- **Sketch**: Small button in the JD `AnalyzeColumn`; POST text+title to the JDs route; on success call `setSelectedJdSlug(newSlug)` and refresh `jdLibrary`.

## 4. Re-run a saved analysis with one click ("Re-analyze")
- **Value**: Medium
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/features/sub_history/HistoryTab.tsx:77` — each saved-run row
- **Gap**: History rows link to a read-only `/history/[slug]` view; there is no path to re-run a candidate against the same or a tweaked JD. CVs change, JDs change, and the model improves — but the only way to refresh a result is to manually re-attach every file from scratch. The intake state lives entirely in `useAnalyzeForm` and is never seeded from a prior run.
- **Opportunity**: A "Re-analyze" action on a history row (and on `/history/[slug]`) that pre-loads the saved `jd_slug` into the Analyze form via the existing `?jd=` deep link (`useAnalyzeJdLibrary.ts:64`) and prompts for a fresh CV, so the recruiter only re-supplies what changed.
- **Why it matters**: Re-evaluation is a core recruiting loop; today it costs a full manual re-entry.
- **Sketch**: Link from `HistoryTab` to `/?tab=analyze&jd=<jd_slug>`; the JD deep-link path already exists — extend it to also focus the CV drop zone.

## 5. Time-aware progress ("≈18s left") instead of a synthetic stage timer
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: S
- **Where it slots in**: `app/features/sub_analyze/AnalyzeApi.ts:46` — the `setInterval` that fakes stage advancement
- **Gap**: The progress strip is theatre: `watchAnalysis` advances stages on a fixed 1800 ms timer (`AnalyzeApi.ts:46`) unrelated to actual pipeline state, even though the run is a real background task polled at `/api/tasks/[id]` that reports concrete progress (`analyze-run.ts:32` `onProgress(done, total)`, especially meaningful for multi-variant runs). The recruiter sees a percent that doesn't reflect reality and no ETA.
- **Opportunity**: Surface the task's real `done/total` (and, for multi-variant, "cached" hits) in `AnalysisProgress`, plus a rolling ETA derived from the model's stated 15–25s budget already shown at `AnalyzeForm.tsx:174`.
- **Why it matters**: Honest progress + ETA reduces abandonment on the app's slowest, most anxiety-inducing screen.
- **Sketch**: Thread the task payload's progress through `watchAnalysis` into `onProgress`; render `done/total` and a countdown in `AnalysisProgress.tsx`.

## 6. Remember the last JD / company across runs
- **Value**: Low
- **Category**: automation
- **Effort**: S
- **Where it slots in**: `app/features/sub_analyze/useAnalyzeForm.ts:130` — `reset()` clears everything
- **Gap**: A recruiter screening five candidates against one role re-attaches the same JD and company overview five times. `reset()` wipes all inputs, and only the in-flight *task id* is persisted to `sessionStorage` (`useAnalyzeForm.ts:23`) — the JD/company selection is not. There is no "keep the role, swap the CV" mode.
- **Opportunity**: Persist the selected `jdSlug` (and pasted company text) to sessionStorage and offer "Keep JD & company" on reset / after a result, so the next candidate starts with the role pre-loaded.
- **Why it matters**: Batch-screening one role against many CVs is the bread-and-butter recruiter loop; this removes repeated re-entry.
- **Sketch**: Stash `selectedJdSlug`/`companyText` alongside `ANALYZE_TASK_KEY`; add a "Keep role" toggle that makes `reset()` preserve those two fields.
