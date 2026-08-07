# CV Analysis Workspace — bug-hunter + ui-perfectionist scan

> Context: Drop, paste, or upload a CV and a target JD, then run a full AI analysis. Drives the Analyze tab intake, file routing, and the analysis run lifecycle.
> Files reviewed: 24 of 32
> Total: 5

## 1. Surface the main-analysis error when a GitHub handle is also supplied

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/features/sub_analyze/AnalyzeTab.tsx:17-48`, `app/features/sub_analyze/AnalyzeFormCollapsed.tsx:29-73`, `app/features/sub_analyze/useAnalyzeForm.ts:228-234`
- **Scenario**: A recruiter fills in a CV **and** a GitHub handle (a common combo) and clicks Analyze. The CV pipeline fails (Python dies / bad payload / `AnalyzeError`). `onError` sets `result.error` and drops `isLoading`/`isCompleting`. The user is shown a collapsed form + the GitHub panel — and **no error anywhere**.
- **Root cause**: `result.error` is rendered *only* inside the expanded `AnalyzeForm` (its `aria-live` block). `hasResult = analysis !== null || githubStatus !== "idle"` — the live GitHub run keeps `hasResult` truthy, so the auto-collapse effect never flips `idle` back to true and never re-expands the form (`AnalyzeTab.tsx:25-30`). `AnalyzeFormCollapsed` has no error slot at all. Without GitHub, `githubStatus` stays `"idle"`, the form auto-expands, and the error shows — so the bug is masked in the simplest path and only bites the CV+GitHub path.
- **Impact**: The core flow fails completely silently. The user assumes the standalone GitHub panel *is* the analysis, or waits indefinitely for a CV report that already failed.
- **Fix sketch**: Render `result.error` in `AnalyzeTab` itself (a banner above the panels, independent of collapse), or force `setExpanded(true)` whenever `result.error` is set. Make "an error is always visible" a state-machine invariant, not a side effect of the collapse heuristic.

## 2. Meter gate is checked at submit but debited at delivery — burst runs exceed the paid cap

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: `app/api/analyze/route.ts:42-43,136-138`, `app/_lib/analyze-run.ts:180`, `app/_lib/billing/enforce.ts:47-62`
- **Scenario**: A workspace has 1 `ai_candidates` unit left. The user opens 3 tabs (or scripts 3 POSTs), each with a *different* CV, within a few seconds. Each `meterGate("ai_candidates")` reads `meterOverview(...).remaining` **before any of them debit** (the debit is `recordMeterUsage` inside the detached background task, seconds later, only on delivery). All three see `remaining >= 1`, all three pass, all three run and debit — the meter lands 2 units over a hard plan cap.
- **Root cause**: Classic check-then-act TOCTOU. The gate's own comment reasons about `minUnits` for *one* action but nothing serializes concurrent actions between gate and debit. The per-IP rate limit (30/10min) is far above any real cap, so it doesn't contain the overage.
- **Impact**: A hard-capped paid meter (whose entire purpose is to bound spend) is bypassable — unfunded Gemini work billed as overage, or free work past the plan limit.
- **Fix sketch**: Reserve the unit atomically at gate time (optimistic debit / pending-hold row keyed by task id, released on failure/cancel), or debit at `startTask` and refund on non-delivery. Make "units in flight" visible to the gate so concurrent submits can't all read the same pre-debit balance.

## 3. Blind screening is silently defeated for the GitHub deep-dive

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/features/sub_analyze/useAnalyzeForm.ts:343-372,405,428`, `app/features/sub_analyze/runAnalysis.ts:115-147`
- **Scenario**: A recruiter ticks **Blind** to strip identity (name/contact/gendered terms) before scoring, and also enters a GitHub handle. `blind` is threaded into the main analysis (`submit` → `executeAnalysis` inputs), but `launchGithubRun` calls `executeGithubAnalysis(githubProfile, { jd }, …)` with **no `blind`**. The deep-dive POSTs the raw handle and renders the candidate's GitHub identity (name, username, repos) beside the blind-scored CV.
- **Root cause**: Blind is a per-run flag applied only on the CV → Python path; the GitHub column is a parallel client-side pipeline that was never made blind-aware. The two "analyses" shown together honor different privacy contracts.
- **Impact**: The anti-bias promise of blind mode is quietly broken exactly when a recruiter relies on it — reviewer sees identity anyway. A fairness/compliance credibility hole, not just a UX nit.
- **Fix sketch**: When `blind` is on, either suppress/disable the GitHub column (with a note "hidden in blind mode") or route it through an identity-redacting variant. Decide the product rule once and enforce it at the single `launchGithubRun` call site.

## 4. [STILL-OPEN] Whole progress panel is one `role="status"` live region wrapping the Cancel button

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/_components/AnalysisProgress.tsx:97-103,129-137,148-156`
- **Scenario**: During a scan the entire card is `role="status" aria-live="polite"`. The fake stage timeline mutates a stage status every ~1.8s, so a screen reader re-announces the headline + percent + all six stage rows on each tick; and the interactive "Cancel scan" `<button>` sits *inside* the live region — an unexpected pattern for AT. (Prior 2026-06-20 finding #5; still present — the panel was translated but not restructured.)
- **Root cause**: `aria-live` is scoped to the whole panel instead of a small text node; interactive controls shouldn't live inside a status region.
- **Impact**: Verbose, repetitive announcements every tick; the focusable Cancel button is buried in a passive-status container.
- **Fix sketch**: Narrow `role="status"`/`aria-live` to a small inner node (current stage title + percent). Move the Cancel button and the `<ol>` stage rows outside the live region (rows already convey state via icon + color).

## 5. Progress bar is fake and discards the real per-variant progress the server already computes

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/features/sub_analyze/AnalyzeApi.ts:41-57,98-111`, `app/_lib/analyze-run.ts:92,112,151`, `app/_components/AnalysisProgress.tsx:87-91`
- **Scenario**: `watchAnalysis` animates the six stages on a hardcoded 1.8s interval and only reads `task.status` from each poll. The bar climbs to ~83% in ~9s, then freezes on "insights active" while a real 30-60s Gemini call runs — and on a 3-CV comparison the same single fake track is shown even though `runAnalyze` emits genuine `onProgress(done, total, label)` per variant (`analyze-run.ts:151`), which the client throws away.
- **Root cause**: The client invents progress instead of surfacing the server's real signal; the task API isn't polled for a progress field, so a long run looks stalled and a multi-variant run misrepresents parallel completion.
- **Impact**: Users read the stall as a hang and cancel/refresh a healthy run; the "Comparing N variants" header has no matching per-variant progress. Success theater on the longest-lived screen of the flow.
- **Fix sketch**: Have the background task persist `{ done, total, label }` and return it from `/api/tasks/[id]`; drive the bar + stage strip from that. Until then, cap the fake bar below 100% honestly and show an indeterminate state after the last known step instead of a frozen 83%.
