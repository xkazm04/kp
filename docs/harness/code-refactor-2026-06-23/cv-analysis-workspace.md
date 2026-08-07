> Total: 5 findings (0c critical, 1h high, 2m medium, 2l low)

## 1. `JdSummary` is duplicated verbatim between `AnalyzeTypes.ts` and `DevTypes.ts`, and its `preview`/`created_at` fields are dead in this context
- **Severity**: High
- **Category**: duplication
- **File**: app/features/sub_analyze/AnalyzeTypes.ts:8-13 (plus app/features/sub_dev/DevTypes.ts:6)
- **Scenario**: `AnalyzeTypes.JdSummary` declares `{ slug; title; preview; created_at }`. `DevTypes.ts:6` declares the byte-identical `export type JdSummary = { slug: string; title: string; preview: string; created_at: string }` with a comment that openly admits "mirrors sub_analyze/AnalyzeTypes.JdSummary; kept local so the dev feature doesn't [import across features]". So the same shape is hand-maintained in two places. Separately, within sub_analyze the `preview` and `created_at` fields are never read: `AnalyzeSavedJdPicker` only uses `slug` and `title` (line 78-79), and a grep for `.preview` / `.created_at` across `app/features/sub_analyze` returns 0 reads. The fields are only populated by the `setJdLibrary(payload.jds as JdSummary[])` cast in `useAnalyzeJdLibrary.ts:31`.
- **Root cause**: Two features consume the same `/api/jds` payload but each minted its own local type to avoid a cross-feature import; the extra fields were copied from the API shape even though the picker never displays them.
- **Impact**: Two copies of one contract drift independently (a server-side rename to `/api/jds` silently breaks one and not the other); the dead fields imply the picker shows a preview/date it doesn't. Low blast radius but pure carrying cost.
- **Fix sketch**: Either trim `AnalyzeTypes.JdSummary` to `{ slug; title }` (the only fields read here), or promote one canonical `JdSummary` to a shared `app/_lib` type and have both `AnalyzeTypes` and `DevTypes` re-export it. Trimming is the smaller, safer step; the `payload.jds as JdSummary[]` cast keeps working since it only narrows.

## 2. `AnalyzeApi.ts` mixes the analyze run-lifecycle (submit/watch) with two unrelated helpers (`extractFileText`, `formatFileSize`)
- **Severity**: Medium
- **Category**: structure
- **File**: app/features/sub_analyze/AnalyzeApi.ts:122-137
- **Scenario**: The file's documented job is the analysis run lifecycle (`submitAnalysis`, `watchAnalysis`). Tacked onto the end are `extractFileText` (a GitHub-deep-dive concern, only called from `runAnalysis.ts`'s `executeGithubAnalysis`) and `formatFileSize` (a pure display util used by `AnalyzeFileDropZone.tsx:6` and `AnalyzeProfileInput.tsx:7`). Confirmed via grep: `formatFileSize` has exactly those two importers inside sub_analyze and none elsewhere in kp; `extractFileText` is imported only by `runAnalysis.ts`. So the seam is real — three unrelated responsibilities behind one filename. (The repo backlog item `idea-fe94a19c-tighten-the-analyzeapi-seam` already flags this exact file.)
- **Root cause**: New helpers were appended to the nearest existing API module rather than placed by concern.
- **Impact**: A reader looking for the file-size formatter or the extractor has to scan the run-lifecycle module; the file accretes unrelated churn. Modest maintenance friction, no correctness risk.
- **Fix sketch**: Move `formatFileSize` to a tiny `formatFileSize.ts` (or co-locate in `upload-constraints.ts`, which already owns the file-size contract) and `extractFileText` next to the GitHub deep-dive code, leaving `AnalyzeApi.ts` to the submit/watch lifecycle. Update the two/one import sites. Pure relocation, no behavior change.

## 3. Two near-identical zombie-callback guard patterns (`githubRunIdRef` and `analysisRunIdRef`) are open-coded across submit/reset/cancel
- **Severity**: Medium
- **Category**: duplication
- **File**: app/features/sub_analyze/useAnalyzeForm.ts:38-49, 168, 209-250, 343-372, 396, 443-446
- **Scenario**: The hook implements the same "monotonic run id + `isCurrent()` gate + supersede on the leading edge" mechanism twice — once for the main analysis (`analysisRunIdRef`, gated by `buildCallbacks`'s `current()`) and once for the GitHub deep-dive (`githubRunIdRef`, gated by `isCurrentGithubRun()`). Each of `submit`, `reset`, and `cancel` then has to remember to bump `githubRunIdRef.current += 1` by hand (lines 168, 396, 443) in addition to the main-run handling in `stopActiveRun`. The comments at 392-395 and 438-442 exist precisely because this is easy to forget. This is the same RAII-style "supersede stale callbacks" idea the codebase uses elsewhere; here it's duplicated inline.
- **Root cause**: The GitHub deep-dive guard was added after the main-run guard, copying the pattern rather than extracting a shared primitive.
- **Impact**: A future lifecycle entry point (e.g. a new "re-run with different language" action) must remember to bump BOTH refs or it reintroduces the exact last-write-wins zombie the comments warn about. The duplication is load-bearing and fragile.
- **Fix sketch**: Extract a small `useSupersedableRun()` helper returning `{ start(): runId, isCurrent(id), supersede() }`, and back both the main and GitHub runs with one instance each. `submit/reset/cancel` then call `.supersede()` on each rather than open-coding `+= 1`. Behavior-preserving; reduces the by-hand bump surface to one named call.

## 4. Stale backlog/`idea-` provenance tags scattered as code comments
- **Severity**: Low
- **Category**: cleanup
- **File**: app/features/sub_analyze/useAnalyzeForm.ts:38,167,302,484 (and similar: AnalyzeForm.tsx:26,224; AnalyzeProfileInput.tsx:58,96; dropRouting.ts header; useAnalyzeForm "GH1/GH3/CV3" tags throughout)
- **Scenario**: Many comments anchor behavior to opaque tracker IDs — `idea-8367f051`, `idea-1a75b476`, `idea-9f3a1c52`, `b8d711c4`, `d95fed6d`, plus internal codes `GH1/GH3/GH5/CV3/DATA4/RES5`. These are commit/backlog references with no in-repo resolution; a reader can't follow `idea-8367f051` to anything. Many are genuinely useful as "why" anchors, but a portion (e.g. bare hex tags with no accompanying explanation) are pure provenance noise.
- **Root cause**: A workflow that stamps each change with its originating idea/ticket id directly into source.
- **Impact**: Minor. Comment churn and a slightly archaeological feel; harmless but adds reading overhead and goes stale once the tracker entry is gone.
- **Fix sketch**: Leave the ones paired with a real explanation; for bare-id-only comments, either drop the id or keep just the one-line rationale. Low priority — do opportunistically when touching the lines, not as a sweep.

## 5. `delay` helper duplicates the standard one-line sleep idiom
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/sub_analyze/AnalyzeApi.ts:5
- **Scenario**: `const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));` is a private one-liner used twice inside `watchAnalysis` (lines 80-81). It's the same `delay`/`sleep` shape that recurs across the codebase. Confirmed it is module-private (not exported, not imported elsewhere). Not harmful, but if the repo has (or wants) a shared `sleep`/`delay` util, this is a small consolidation candidate.
- **Root cause**: A trivial helper inlined locally rather than reaching for a shared util.
- **Impact**: Negligible — one tiny private function. Listed only for completeness as a consolidation target if a shared timing util already exists.
- **Fix sketch**: If `app/_lib` already exports a `sleep`/`delay`, import it and delete the local copy; otherwise leave as-is (extracting one liner to a shared module isn't worth a new file).
