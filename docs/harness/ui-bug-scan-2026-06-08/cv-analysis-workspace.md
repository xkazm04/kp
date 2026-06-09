# CV Analysis Workspace — UI+Bug combined scan
> Total: 4 findings (0 crit / 2 high / 2 med / 0 low)
> Group: Candidate Analysis & Scoring | Lens mix: 3 bug / 1 ui | Files read: 19

Note: the analyze poll-loop is already hardened (AbortSignal + consecutive-error
bail + 404-terminal in `AnalyzeApi.watchAnalysis`, abort on reset/cancel/unmount,
monotonic run-id guards for both the main and GitHub runs). Verified, not re-flagged.

## 1. Picking a saved JD then submitting immediately runs the analysis JD-blind while recording the slug
- **Severity**: High
- **Lens**: 🐛 Bug
- **Category**: Race / silent correctness gap at the submit boundary
- **File**: `app/features/sub_analyze/useAnalyzeJdLibrary.ts:35-57` (pick), `app/_lib/analyze-run.ts:34-41` (cliArgs), `app/features/sub_analyze/AnalyzeForm.tsx:178-182` (submit gate)
- **Scenario**: User picks a JD from the "From library" dropdown and clicks **Analyze** within the next few hundred ms (before the body fetch returns), or on a slow connection.
- **Root cause**: `pickJd` records `selectedJdSlug` synchronously but only populates `jobDescriptionText` *after* an async `GET /api/jds/[slug]` resolves (lines 39-50). The Analyze button is enabled the moment a CV is attached — it does not wait for the JD body. On the server, `jdSlug` is **never resolved to JD content**: `cliArgs` builds the pipeline args from `jobDescriptionText`/`jobDescriptionPath` only (`analyze-run.ts:37-38`), and `jdSlug` is used purely for the log line (`jd_slug`) and the persisted record label (`persistAnalysis`, lines 156/171/190). So if the textarea is still empty at submit time, the run executes with no JD.
- **Impact**: A job-fit analysis silently runs without the job description the user explicitly selected, yet the saved/persisted analysis is tagged with that slug — the result looks JD-grounded but isn't. Worse than the file-only-JD case the GitHub path already warns about, because here there is no warning at all and the slug provenance is misleading. Cache key (`computeCacheKey`) also keys on empty JD text, so the wrong (JD-blind) result can be cached and reused.
- **Fix sketch**: Block submit while a JD pick is in flight (expose a `jdLoading` flag from `useAnalyzeJdLibrary`, OR'd into the button's `disabled`), or resolve `jdSlug → body` server-side in `/api/analyze` when `jobDescriptionText` is empty but a slug is present, so the slug is the source of truth rather than a label.

## 2. Cancel scan leaves the GitHub deep-dive running and the Analyze button stuck disabled
- **Severity**: High
- **Lens**: 🐛 Bug
- **Category**: Timing / orphaned async run, blocked recovery
- **File**: `app/features/sub_analyze/useAnalyzeForm.ts:314-317` (cancel), `162-172` (stopActiveRun), `256-291` (github launch), `349` (githubLoading gate)
- **Scenario**: User attaches a CV + GitHub profile, clicks Analyze, then clicks **Cancel scan** while the GitHub deep-dive (which can outlive the main analysis) is still loading.
- **Root cause**: `cancel()` calls `stopActiveRun()` + resets stage state. `stopActiveRun()` aborts the *main* poll and bumps `analysisRunIdRef`, but it does **not** touch `githubRunIdRef`. Unlike `reset()` (line 133, which bumps `githubRunIdRef` to supersede the GitHub run), `cancel()` never supersedes it. The GitHub fetch is fire-and-forget with **no AbortController** (lines 270-291), so it keeps running and its guarded callbacks still pass `isCurrentGithubRun()` — `onResult`/`onError` fire and set `githubStatus`/`githubAnalysis` on the now-cancelled form.
- **Impact**: After Cancel, `githubStatus` stays `"loading"`, so `flags.githubLoading` (line 349) keeps the **Analyze button disabled** (`AnalyzeForm.tsx:181`) — the user cannot retry until the abandoned GitHub call finally resolves (up to the route's full timeout). Zombie GitHub state also lands on a run the user explicitly cancelled.
- **Fix sketch**: In `cancel()`, supersede the GitHub run the same way `reset()` does (`githubRunIdRef.current += 1`) and `setGithubStatus("idle")`; ideally give `executeGithubAnalysis` an AbortSignal so the in-flight fetch is actually cancelled, not just ignored.

## 3. Async content-hash dedupe races on rapid identical CV drops, admitting a true duplicate variant
- **Severity**: Medium
- **Lens**: 🐛 Bug
- **Category**: Stale-closure race in async intake
- **File**: `app/features/sub_analyze/useAnalyzeForm.ts:89-107` (addCvFile)
- **Scenario**: User drops/selects the **same** CV file twice in quick succession (e.g. double drop, or drop + add-variant before the first re-render), or a multi-file drop loop calls `addCvFile` for each.
- **Root cause**: `addCvFile` is `async` and `await`s `isDuplicateCvVariant(file, cvFiles)` against the **closure snapshot** of `cvFiles`. Two near-simultaneous invocations both capture the same (pre-update) `cvFiles`, both hash and both compute `duplicate = false` (neither sees the other's pending append), then both append. The functional `setCvFiles((prev) => prev.length >= MAX ? prev : [...prev, file])` (line 106) guards only the *count* cap, not content identity — so two byte-identical clones can both enter state.
- **Impact**: A duplicate variant survives client-side. The server `collectCvFiles → dedupeCvVariants` (`api/analyze/route.ts:92`) does collapse it, so it won't run twice — but the UI shows "2 variants" / "Variant A/B" of the same file, a misleading state and a count the user must manually fix. (The cap itself is safe; only dedupe races.)
- **Fix sketch**: Move dedupe inside the functional updater (hash off the latest `prev`), or serialize intake through a ref-held queue / `flushSync`-style guard so each add sees prior pending adds. At minimum, re-check duplicate against `prev` inside `setCvFiles`.

## 4. Saved-JD picker gives no loading or failure feedback while the JD body fetches
- **Severity**: Medium
- **Lens**: 🎨 UI
- **Category**: Missing loading/error state
- **File**: `app/features/sub_analyze/AnalyzeSavedJdPicker.tsx:50-71`, `app/features/sub_analyze/useAnalyzeJdLibrary.ts:39-54`
- **Scenario**: User picks a JD from the dropdown on a slow connection, or the `GET /api/jds/[slug]` body fetch fails / returns a non-`{body:string}` shape.
- **Root cause**: `pickJd` sets the slug immediately but fills the textarea only after the async body fetch (`useAnalyzeJdLibrary.ts:39-50`). The picker shows the selection as committed (the `<select>` value flips, the "Detach" affordance appears) with **no spinner or disabled/busy state** during the fetch. On failure the `.catch` silently leaves the textarea empty (line 52-54) and the type-guard at line 50 silently skips a malformed body — the dropdown still reads as "JD selected" with an empty Paste-content area and no message.
- **Impact**: The UI claims a JD is attached while the field is empty, with no signal that loading is in progress or that it failed. This is the visual surface of finding #1 and a standalone UX gap — the user has no way to know the JD didn't actually load, and the column's "attached/optional" status (`useAnalyzeForm` `jobStatus`) keys off the empty textarea, so it can disagree with the picker.
- **Fix sketch**: Track per-pick loading in the hook and reflect it in the picker (disable the `<select>`, show a small "Loading JD…" affordance), and surface a `role="alert"` inline message when the body fetch fails or returns an unexpected shape instead of silently no-op'ing.
