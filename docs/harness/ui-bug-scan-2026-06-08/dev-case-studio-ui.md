# Dev Case Studio (UI) — UI+Bug combined scan
> Total: 4 findings (0 crit / 1 high / 3 med / 0 low)
> Group: Dev Case Automation | Lens mix: 3 bug / 1 ui | Files read: 16

(Note: two files named in the brief — `PostingsSection.tsx`, `ApprovedCasesSection.tsx` — do not exist in the tree; the real posting/submission surfaces are `CasesTable.tsx` and `CaseDetail.tsx`, which were read instead.)

## 1. Submission record silently lost on a failed POST
- **Severity**: High
- **Lens**: 🐛 Bug Hunter
- **Category**: Silent failure / missing error handling
- **File**: `app/features/sub_dev/SubmissionForm.tsx:11-26`
- **Scenario**: A recruiter records a candidate submission. The POST to `/api/devcase/submit` returns a non-2xx (validation error, duplicate token, `SQLITE_BUSY`, 500). The form clears both inputs and calls `onDone()` (postings reload) exactly as if it had succeeded. The submission silently vanishes — no error, no retained input, and the postings list reloads to its prior state, so it looks like the record "didn't take" with zero signal why.
- **Root cause**: `send()` never inspects `r.ok`. It `await`s the fetch, then unconditionally `setCandidate("")` / `setRepo("")` / `onDone()` in the try block (lines 15-22). The `finally` only resets `busy`. Contrast `control/page.tsx:83-87` (`recordOutcome`) which correctly gates on `r.ok`, surfaces `p?.error`, and keeps the form intact — that pattern was not applied here.
- **Impact**: Lost candidate submissions on the common error path with no recourse; the recruiter believes the candidate is in the pipeline when they are not. Directly undermines the "no submission dropped" guarantee the rest of the studio (LoadStatus stale pills, outbox dead-letter) is built around.
- **Fix sketch**: Mirror `recordOutcome`: `if (!r.ok) { setErr(...); return; }` before clearing/`onDone()`; only reset inputs on success; add a `catch` that surfaces a network error. Render the error inline (the form currently has no error slot). Keep `busy`-disable as the double-submit guard it already is.

## 2. Already-promoted submissions re-expose the Promote button (duplicate promote)
- **Severity**: Medium
- **Lens**: 🐛 Bug Hunter
- **Category**: State edge case / duplicate action
- **File**: `app/features/sub_dev/SubmissionRow.tsx:24,49-56` + `app/features/sub_dev/EvalPanel.tsx:163-171`
- **Scenario**: A submission was already promoted to Decisions — either earlier in the session before a reload, or auto-promoted by the lifecycle pipeline (the lifecycle "promotes the top candidates into Decisions" per `LifecycleSection.tsx:13`). On the next render `EvalPanel` shows "Promote to pipeline" again because the only thing it consults is the local `promoted` boolean, which always starts `false`. A second click fires another `/api/devcase/promote`.
- **Root cause**: `promoted` is component-local `useState(false)` (`SubmissionRow.tsx:24`) seeded only by a successful click in this mount. Nothing reads `submission.status` (the type carries `status?: string`, `DevTypes.ts:77`) or any server-side promoted marker, so server truth is invisible to the button. There is also no in-flight guard on `promote()` — the button isn't `disabled` while the POST is pending, so a fast double-click double-promotes within one mount too.
- **Impact**: Duplicate Decisions review cards / duplicate promote side effects (comms invite re-sent from the outbox). Degrades the human-in-the-loop record the control room is meant to keep clean.
- **Fix sketch**: Derive the initial promoted state from server data (`submission.status === "promoted"` or equivalent) and OR it with the local flag; disable the Promote button while the POST is in flight (a `busy` ref/state like `evaluate` uses). Optionally have `onChanged()` refresh status so a pipeline auto-promote reflects without a manual reload.

## 3. Fit chip and rank disagree for a freshly-evaluated submission
- **Severity**: Medium
- **Lens**: 🐛 Bug Hunter (with UI symptom)
- **Category**: Edge case / score-rendering inconsistency
- **File**: `app/features/sub_dev/CaseDetail.tsx:157-164` + `app/features/sub_dev/SubmissionRow.tsx:58-83`
- **Scenario**: A recruiter clicks Evaluate on a submission. The eval task lands; `SubmissionRow` immediately shows a transfer-fit chip sourced from the fresh bundle (`submission.transferScore ?? ev?.transfer?.transferScore`, line 58). But the parent list's sort and rank read **only** the persisted `submission.transferScore`, which is still null until the `onChanged` postings reload completes. So the top candidate renders a "fit" chip (e.g. `82 fit`) yet sorts to the bottom of the list and shows **no `#rank` badge and no "Top match" pill**.
- **Root cause**: Two different score sources for one row. `CaseDetail` sorts by `b.transferScore ?? -1` and sets `rank = s.transferScore != null ? i+1 : null` (lines 158-160) — persisted-only. `SubmissionRow` falls back to the in-memory eval bundle for the chip but the parent can't see that bundle. During the gap between "eval succeeded" and "postings reloaded" the two views contradict.
- **Impact**: The strongest candidate momentarily appears unranked/last directly beneath a high fit score — a confusing, self-contradictory ordering on the exact screen a recruiter uses to pick whom to advance. Self-heals after reload, but the window is the moment of peak attention.
- **Fix sketch**: Make the chip source and the rank source the same. Simplest: rank/sort off `submission.transferScore` only and have the chip also prefer persisted score (accept the brief flicker), OR lift the fresh transferScore up via `onChanged` so the parent re-sorts. Avoid showing a fit chip the list can't yet rank by.

## 4. Kill-switch state glyph is unlabeled; control room drifts off the type/color scale
- **Severity**: Medium
- **Lens**: 🎨 UI Perfectionist
- **Category**: Accessibility + design-system consistency
- **File**: `app/control/page.tsx:149-151` (glyph) ; `:204,217-223,233,239-256` (scale/actor)
- **Scenario**: The autonomy kill switch — the most safety-critical control in the feature — conveys running-vs-paused through a bare text glyph (`❚❚` / `▶`) inside a colored circle (line 150). The span has no `aria-label` and is not `aria-hidden`, so a screen reader announces a stray pause/play character (or nothing meaningful) and state rests on color + the adjacent paragraph alone. Separately, this page hand-rolls arbitrary font sizes (`text-[11px]`, `text-[10px]`, `text-[9px]` across lines 183, 204, 218-223, 226, 233, 239-297) and a one-off `bg-stone-200 text-steel` system-actor chip (line 22), where every sibling in `sub_dev/*` uses the `text-micro`/`text-meta` tokens and the shared `moss/amber/coral` chip palette (cf. `OutboxSection.tsx`, `LifecycleRow.tsx`).
- **Root cause**: The status circle was styled visually without an accessible name; the control page predates / sidesteps the typography tokens the rest of the studio standardized on, so its rows render a noticeably smaller, denser, off-scale look.
- **Impact**: A non-sighted operator gets no reliable read of whether automation is paused (a compliance-relevant kill switch), and the oversight room visually reads as a different, less-polished surface than the studio it governs. Not a crash, but a notable a11y gap on the highest-stakes control plus a real cross-section inconsistency.
- **Fix sketch**: Add `aria-hidden` to the glyph and an `aria-label`/visually-hidden state text on the circle (or move the state into an `aria-live` region so a pause/resume is announced). Replace the `text-[Npx]` literals with the `text-micro`/`text-meta` scale and route the actor chip through the shared status-color map already used by `OutboxSection`/`LifecycleRow`. No behavior change.
