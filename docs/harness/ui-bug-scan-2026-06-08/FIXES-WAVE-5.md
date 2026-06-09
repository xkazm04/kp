# UI+Bug Scan — Fix Wave 5: Stale UI / fetch-state

> 8 findings closed (5 High, 3 Medium) across 7 atomic commits (+ a bonus encodeURIComponent).
> Baseline preserved: tsc 0 → 0, next build ✓, unit 638 → 638.
> One mental model: **keep views fresh; surface fetch errors with a retry; never leave a dead loading/empty state.**

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `c4571ce` | useJsonFetch 204/empty-body → eternal loading | High | useJsonFetch.ts |
| 2 | `cb35c32` | analytics error state is a dead end (no retry) | High | AnalyticsTab.tsx |
| 3 | `980bdac` | match re-weight blanks the result to placeholder | High | MatchTab.tsx |
| 4 | `4cf40aa` | recruiter Candidates stale on job switch (+encode) | High (+Med) | RecruiterCandidates.tsx |
| 5 | `5662f88` | StageCell "+N more" persists stale across filter | Medium | PipelineBoard.tsx |
| 6 | `24ceb15` | sim getEntries swallows non-OK into empty board | Medium | SimulationProvider.tsx |
| 7 | `208a01f` | board stale under automation + SchedulerControl gap | High + Med | PipelineTab.tsx |

(Commit 7 closes BOTH pipeline findings #1 and #2: a 30s board poll reconciles after any background mutation, which subsumes the SchedulerControl "ran but board didn't move" wire per the INDEX.)

## What was fixed (grouped by sub-pattern)

### Dead loading / empty states with no recovery
1. **useJsonFetch eternal loading** — a 204 / empty / non-JSON 2xx setData(null)'d, pinning the 5+ dashboard tabs in a permanent skeleton. An empty body from these always-JSON endpoints is now a reload-able error.
2. **analytics dead end** — the tab dropped `reload`, so a transient 500 became a permanent broken dashboard. The error branch now has a Retry button (role="alert").
3. **match re-weight flash** — `setResult(null)` on every run unmounted Results + the WeightsPanel to the placeholder. The prior result now stays mounted (`<Results loading>`), and a fresh run shows a loading branch.

### Stale views after a background / cross-surface change
4. **recruiter Candidates stale on job switch** — the modal reused across jobs kept the previous job's candidates (effect keyed on [autoLoad] + a `!data` guard). Now reloads once per jobId via a ref; also encodeURIComponent's the jobId (the bonus Med).
5. **StageCell stale expansion** — `expanded` survived a lane-content swap under a stage-stable key; the cell key now folds in the entry-id signature so it remounts (and resets) only when contents change.
7. **board stale under automation** — the heartbeat mutates entries server-side with no client signal, so the open board misrepresented state (and SchedulerControl could show a run the lanes didn't reflect). PipelineTab now polls every 30s (reusing load()'s abort+cursor machinery), paused on an open drawer / hidden tab.

### Swallowed failure → misleading empty
6. **sim getEntries** — `?? []` turned a transient 500 into "intake returned none," silently halting a sim beat. It now throws on non-OK so the sim's error handling sees it.

## Verification (before / after)

| Gate | Baseline (B2) | After Wave 5 |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| next build | ✓ | ✓ (Compiled successfully) |
| test:unit | 638 pass | 638 pass |
| eslint (touched files) | — | clean except 2 PRE-EXISTING `set-state-in-effect` in PipelineTab's SLA-override localStorage loader (lines 102/119, from the earlier PIPE4 feature — NOT touched by this wave) |

No regressions. The new poll/ref effects in PipelineTab are lint-clean (the interval calls load(); drawer state is synced via a ref in its own effect).

## Cumulative status (waves 1–5)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Trust-boundary & validation (security) | 8 |
| 2 | Data integrity (lost-updates & dropped writes) | 7 |
| 3 | Identity-by-label / wrong-record | 5 |
| 4 | Concurrency & idempotency | 6 |
| 5 | Stale UI / fetch-state | 8 |
| | **Total** | **34** |

**49 findings remain across 4 themes** (silent-failures, score/number consistency, accessibility, UI-states/polish — all Medium/Low).

## Patterns established (catalogue items 16–17)

16. **No client signal for a server-side background mutation.** A same-document event bus / on-mount fetch can't see changes a server heartbeat makes. Add a paused-when-idle poll (or a real push stream) reusing the existing abort+cursor fetch, so an open view reconciles.
17. **`?? []` / setData(null) on a fetch hides failure as "empty/loading".** Coercing a non-OK or empty response to an empty array / null reads as "no data" or "still loading" forever. Check `r.ok`, distinguish empty-success from failure, and give the error state a retry.

## What remains

49 findings across 4 themes (INDEX). Recommended next: **Wave 6 — Silent failures & opaque errors** (onboarding-dispatch reconcile, deep-review evidence on partial fetch, policy-pass empty "ok", sim offer-link try/catch, diagram failure UX, salaryBandPosition NaN, sim reset re-orphan) — ~7 fixes sharing "no swallowed errors; reconcile flags; degrade visibly."
