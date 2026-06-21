# High Fix Wave 1 — silent-failure / no-r.ok / success-theater

> 7 High findings closed in 4 atomic commits, one mental model: *actions that swallow
> errors or fake success → check the result, surface failure, give feedback.*
> Baseline preserved: tsc **0**, `next build` ✓, unit **1019/1019**, i18n parity (2820 keys, en/cs).

## Commits

| Commit | Findings | Fix |
|---|---|---|
| `d2bb9cf` | dev-case-authoring #1 | DevTab publish/approve/source/lifecycle routed through a shared `runAction()` that checks `r.ok`, prefers the server `{ error }`, raises a dismissable banner; reload only on success. |
| `c664f65` | sourcing #1 | RediscoveryFeed's declared-but-unwired `AbortController` now actually receives a controller + `signal`, so the pool-sweep cancels on unmount (was dead code). |
| `0351e3d` | group-evaluation #1 | group-eval `decide()` flipped to a success pill unconditionally while `onDecide` no-ops for a candidate who left the pool. `onDecide` now returns whether it acted; the pill commits only on a real success, retry stays live. |
| `f08587d` | pipeline-board, interview-sim, job-postings, jd-authoring (4) | (a) PipelineTab drag-move shows a "couldn't move" notice instead of silently reverting; (b) InterviewSim "Attach" distinguishes a fetch error (Retry) from "no candidates"; (c) JobPostingModal's 3 clipboard copies show a "copy manually" alert instead of a silent catch; (d) LibraryTab Ingest/Duplicate add a `role="alert"` reason (was a label-only change, invisible to SR). |

## Why these grouped this way
The 4th commit bundles four distinct findings because they all add strings to the shared
`messages/{en,cs}.json` catalog (the i18n-parity CI gate + the `Messages = typeof en` TS
gate require keys to land WITH their consumers). The other three are i18n-free and stayed
atomic.

## Pattern catalogue additions
9. **A label-only failure state is invisible to assistive tech.** Changing a button's text
   from "Ingest" to "Retry" on error isn't announced; pair it with a `role="alert"` reason.
10. **Declared-but-unwired cleanup is worse than none.** An `AbortController` ref that's
    aborted but never attached to a fetch reads as a kept guarantee in review while doing
    nothing — wire the `signal` or delete the ref.
11. **Optimistic UI must commit on the real outcome.** Flip to the success state only after
    the action confirms it landed (return a boolean from the handler), or it lies on a no-op.

## What remains in this theme
The cluster had ~30 candidates; this wave took the 7 highest-leverage frontend ones. Still
open (mostly backend / Python, their own waves): communications `received_count` retry
inflation, LLM-layer double-billing on repair/truncation, `_extract_pdf` swallowing per-page
failures, `parsePythonJson` returning a trailing log line as the result, `anonymizeProfile`
workspace-pinned silent no-op, and the missing-loading-state Highs (MatchTab select,
JobLifecycleStrip, CV-add).
