# Bug Hunt — CV Analysis Workspace

> Total: 7
> Critical: 1 | High: 3 | Medium: 2 | Low: 1

## 1. watchAnalysis poll loop + interval never abort — leak on unmount / tab switch
- **Severity**: Critical
- **Category**: recovery-gap
- **File**: app/features/sub_analyze/AnalyzeApi.ts:37-71
- **Scenario**: If a user starts a scan, then switches the workspace segmented control from "New analysis" to "History" (AnalyzeWorkspace `AnimatePresence mode="wait"` unmounts `<AnalyzeTab/>`), or navigates away while a run is in flight...
- **Root cause**: `watchAnalysis` is an unbounded `while (true) { await delay(1500); fetch(...) }` loop plus a `window.setInterval(tick, 1800)`, with NO `AbortSignal` parameter and no way for the caller to stop it. `executeAnalysis`/`resumeAnalysis` (runAnalysis.ts:36-62) likewise take no signal, and `useAnalyzeForm` never holds an AbortController. The resume effect's cleanup (useAnalyzeForm.ts:191) only clears the 0 ms kick-off timer — once the loop is running nothing tears it down. The whole feature assumes the component lives forever once a run begins.
- **Impact**: After unmount the loop keeps polling `/api/tasks/[id]` every ~1.5 s indefinitely and, on success, calls `callbacks.onResult`/`onFinalize` → `setState` on an unmounted component (React "update on unmounted component" + wasted network forever). The interval also leaks. Multiple start→switch cycles stack independent zombie pollers.
- **Fix sketch**: Thread an `AbortSignal` through `executeAnalysis`/`resumeAnalysis`/`watchAnalysis`; pass `{ signal }` to every `fetch`, check `signal.aborted` at the top of the `while` loop to `return`/throw, and `clearInterval` in `finally`. In `useAnalyzeForm`, hold an `abortRef = useRef<AbortController|null>(null)`, create one per `submit`/resume, and `abortRef.current?.abort()` in a `useEffect` unmount cleanup — exactly the PipelineTab `abortRef` pattern (PipelineTab.tsx:76-127).

## 2. Reset during a running scan leaves a zombie run that clobbers the cleared state
- **Severity**: High
- **Category**: state-corruption
- **File**: app/features/sub_analyze/useAnalyzeForm.ts:120-135
- **Scenario**: If a user clicks "Reset" in the expanded `AnalyzeForm` on the leading edge of a scan (the Reset button at AnalyzeForm.tsx:37-45 is NOT `disabled` while analyzing, unlike the collapsed variant's), then the in-flight `watchAnalysis` later resolves...
- **Root cause**: `reset()` clears inputs/`analysis`/`stageState` and bumps `githubRunIdRef`, but it never sets `isLoading`/`isCompleting` to false, never aborts the main `watchAnalysis` poll (no abort exists — see #1), and never DELETEs the server task. There is no run-id guard on the MAIN analysis callbacks (only the GitHub run is guarded). The design assumes the main run is uncancellable and its callbacks always represent the current intent.
- **Impact**: After Reset the spinner keeps spinning (loading flags stuck true), and when the orphaned poll succeeds, `onResult` writes the stale `analysis` back over the just-cleared form — the user "reset" but a result they thought they discarded reappears. `clearStoredTask()` also removes the session key for a task that is still running on the server.
- **Fix sketch**: In `reset()`, `abortRef.current?.abort()` (after #1 lands), set `setIsLoading(false); setIsCompleting(false)`, fire-and-forget `fetch('/api/tasks/'+storedId, { method: 'DELETE' })`, and add a monotonic `analysisRunIdRef` guard mirroring `githubRunIdRef` so superseded main-run callbacks are ignored. Until abort exists, at minimum disable the expanded Reset button while `isLoading || isCompleting`.

## 3. Poll loop has no terminal/timeout — a 404 or deleted task spins forever
- **Severity**: High
- **Category**: silent-failure
- **File**: app/features/sub_analyze/AnalyzeApi.ts:54-66
- **Scenario**: If `/api/tasks/[id]` returns non-200 permanently (the task row is gone, or the in-memory runner was lost to a `next dev` hot-restart and the DB row was reaped), or returns a body with no `task`...
- **Root cause**: `if (!r.ok) continue;` and `if (!task) continue;` treat every transient AND permanent failure identically as "keep waiting." There is no max-attempt count, no overall deadline, and no consecutive-failure threshold. The loop only ever exits on an explicit `succeeded`/`failed`/`canceled`/`interrupted` status — a state it may never reach.
- **Impact**: Stuck-state: the progress UI shows "Live pipeline / Calling Gemini…" forever with no error and no escape (no cancel UI — see #4). The user must reload. A permanently-404ing task is indistinguishable from a slow one.
- **Fix sketch**: Track `consecutiveErrors`/elapsed time; after N consecutive non-ok polls or an overall timeout (e.g. > 90 s past the 15–25 s expectation) throw `new Error("Lost track of the analysis — please retry.")` so `executeAnalysis`'s catch surfaces it via `onError`. Distinguish 404 (terminal — task vanished) from 5xx (retryable).

## 4. No cancel affordance despite a working DELETE — only escape is a page reload
- **Severity**: Medium
- **Category**: recovery-gap
- **File**: app/features/sub_analyze/AnalysisProgress.tsx:80-152
- **Scenario**: If a user starts a scan against the wrong CV/JD and wants to stop it...
- **Root cause**: The backend fully supports cancellation — `DELETE /api/tasks/[id]` → `cancelTask` aborts the running handler (tasks/[id]/route.ts:15-19, tasks.ts:195-208) — but `AnalysisProgress` renders no Cancel button and `useAnalyzeForm` never calls DELETE. The workspace assumes a scan, once launched, always runs to completion.
- **Impact**: UX-degradation / wasted compute: a mistaken or slow run cannot be stopped; it consumes one of only `MAX_CONCURRENT = 2` task slots until it finishes, blocking other work. Combined with #3, a wedged run is unrecoverable without a reload.
- **Fix sketch**: Add a "Cancel scan" button in `AnalysisProgress` wired to a `handlers.cancel` that aborts the local poll (#1) and `fetch('/api/tasks/'+storedTaskId, { method: 'DELETE' })`, then resets the loading flags. The poll already treats `canceled` as a terminal state, so the loop will exit cleanly.

## 5. JD library auto-load sets textarea to a non-string `jd.body` → render crash
- **Severity**: Medium
- **Category**: validation-gap
- **File**: app/features/sub_analyze/useAnalyzeJdLibrary.ts:24-36
- **Scenario**: If the page is opened with `?jd=<slug>` and `/api/jds/[slug]` returns a JSON shape without a string `body` (e.g. `{ error }`, a renamed field, or a partial record)...
- **Root cause**: Line 33 calls `setJobDescriptionText(jd.body)` with no type guard, unlike the on-demand picker path in AnalyzeForm.tsx:95 which correctly guards `typeof full?.body === "string"`. The effect assumes the slug endpoint always returns `{ body: string }`.
- **Impact**: Crash: `jobDescriptionText` becomes `undefined`, then `useAnalyzeForm.ts:54` (`jobDescriptionText.trim()`) and the controlled `<textarea value=...>` throw on the next render — the whole Analyze tab white-screens from a shareable URL.
- **Fix sketch**: Guard like the picker does: `if (typeof jd?.body === "string") setJobDescriptionText(jd.body);` and only `setSelectedJdSlug(jd.slug)` when `jd.slug` is a string.

## 6. Saved-JD picker has a stale-response race: textarea and selected slug disagree
- **Severity**: Medium
- **Category**: race-condition
- **File**: app/features/sub_analyze/AnalyzeForm.tsx:87-100
- **Scenario**: If a user picks JD "A", then quickly picks JD "B" before A's body fetch returns (or A is on a slow connection)...
- **Root cause**: `onPick` sets `setSelectedJdSlug(jd.slug)` synchronously, then `await fetch('/api/jds/'+slug)` and `setJobDescriptionText(full.body)`. There is no request sequencing, abort, or "is this still the latest pick?" guard. The slower A response can resolve after B, last-write-winning the textarea.
- **Impact**: state-corruption: the dropdown shows "B" and `selectedJdSlug === "B"`, but the textarea holds A's body — and since the analyze run prefers the typed/library text, the user unknowingly analyzes against the wrong JD.
- **Fix sketch**: Capture the picked slug per call and ignore the response if `selectedSlug` has since changed, or use a per-pick `AbortController` stored in a ref and abort the previous fetch on each new pick (PipelineTab abort pattern). Only apply `full.body` when its slug still matches the current selection.

## 7. Stage strip advances on a fixed timer, decoupled from real pipeline progress
- **Severity**: Low
- **Category**: silent-failure
- **File**: app/features/sub_analyze/AnalyzeApi.ts:42-49
- **Scenario**: If the real run is much faster than ~9 s (cache hit, all stages "done" server-side) or much slower than the 6×1800 ms timeline...
- **Root cause**: The `setInterval` "soft timeline" walks the six stages on a hard-coded 1.8 s cadence regardless of the task's actual `progress` field (the route DOES report `setTaskProgress` done/total, which is never read here). The comment concedes "the pipeline emits one final result, not per-token stages" — so the strip is decorative, not truthful.
- **Impact**: UX-degradation / success-theater: on a slow run the strip parks on "Generating insights · active" long before insights exist; on a fast/cached run it still crawls. The percentage and active stage can mislead the user about where the run actually is, and mask a wedged run (see #3) as "still working."
- **Fix sketch**: Read the polled `task.progress` (done/total/msg) from each `/api/tasks/[id]` response and drive the stage strip from it (map progress fraction → STAGE_ORDER index), keeping the timer only as a gentle interpolator between real updates so it can never run ahead of the true state.
