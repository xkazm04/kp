# Dev Submissions & Live Work Surface — UI Perfectionist scan

> Context: Candidate-facing dev case workspace (live coding surface, seed files) plus recruiter-side submission review, authenticity scoring, and side-by-side submission comparison.
> Files reviewed: 12 of 24
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Live Work Surface has no error message after a failed final submit, and points to a non-existent fallback

- **Severity**: High
- **Category**: error-state / misleading-copy
- **File**: `app/devcase/apply/[token]/LiveWorkSurface.tsx:142` (and `app/devcase/apply/[token]/page.tsx:88`, `messages/en.json devApply.workSurface.error`)
- **Scenario**: A candidate works in the live surface, fills name + a valid email, clicks Submit, and the `POST /api/devcase/session/{sid}/submit` returns non-2xx (or `sessionIdRef` is null). `status` flips to `"error"` and the only feedback is the inline `workSurface.error` string.
- **Root cause**: The error string reads "Couldn't submit — try again, or use the repository-link option below," but `page.tsx` renders the `LiveWorkSurface` *instead of* `DevApplyForm` (mutually exclusive via `seedFiles.length > 0`). There is no repo-link option on the page, so the copy directs the candidate to a control that does not exist.
- **Impact**: A candidate whose submission fails is told to use a fallback that isn't there; the take-home work they just typed into the textarea is at risk of being lost on reload. For the one and only submit path of a workspace case, this is a dead-end failure.
- **Fix sketch**: Either (a) change the copy to drop the "repository-link option below" clause and add a visible Retry affordance, or (b) keep a true fallback by also rendering `DevApplyForm` on persistent error. Also warn-before-unload while `files` differ from the seed so typed work isn't silently discarded.

## 2. Live Work Surface editor offers no empty-seed / single-pane guard and renders a bare `<textarea>` as the "editor"

- **Severity**: Medium
- **Category**: missing-empty-state / a11y
- **File**: `app/devcase/apply/[token]/LiveWorkSurface.tsx:148`, `:182`
- **Scenario**: `active = files.find(...) ?? files[0]`. If `seedFiles` is `[]`, the page-level guard routes to `DevApplyForm` so this normally has ≥1 file — but a seed with files whose `contents` are all empty, or a future single-empty-file seed, renders an unlabeled blank textarea with `aria-label={active?.path ?? "editor"}` (the literal English fallback "editor", untranslated) and no placeholder, no "what am I supposed to do here" affordance.
- **Root cause**: The component assumes a well-formed multi-file seed and never renders an instructional empty/loading state for the editor pane; the `aria-label` fallback is a hard-coded English string in an i18n app.
- **Impact**: A confusing blank pane for the candidate; screen-reader users on the fallback hear "editor" in the wrong language; no guidance ties the textarea back to the task list.
- **Fix sketch**: Add a placeholder + a short caption ("Edit `{path}` — your edits are recorded"). Move the `aria-label` fallback to a translated key. Consider disabling Submit until at least one file diverges from the seed (a "you didn't change anything" guard).

## 3. `SeedFiles` component (per-file download + collapsible preview) is built but never rendered — dead UI, and its capabilities are missing from the live surface

- **Severity**: Medium
- **Category**: dead-control / component-extraction
- **File**: `app/devcase/apply/[token]/SeedFiles.tsx:13` (only `import type { SeedFile }` is referenced in `LiveWorkSurface.tsx:5` and `page.tsx:9`)
- **Scenario**: A candidate on a workspace case sees only the minimal file-button list + textarea in `LiveWorkSurface`. The polished `SeedFiles` panel — "Download all", per-file download, collapsible `<details>` previews, translated `seedHeading`/`seedDownloadAll` keys — exists but is wired into no page.
- **Root cause**: The page was reworked so the live surface became the "SOLE submit path," but the `SeedFiles` presentation component was left orphaned. ripgrep confirms no component-level import anywhere; only the `SeedFile` *type* is reused.
- **Impact**: A whole tested, translated UI affordance (download the starter files to work locally) is invisible to candidates. Maintenance cost + i18n keys for a surface nobody can reach; the live surface lacks any "take the files offline" path.
- **Fix sketch**: Either delete `SeedFiles.tsx` if the offline path is intentionally dropped, or render it above the editor in `LiveWorkSurface`/`page.tsx` to restore per-file/all download. Don't ship maintained-but-unreachable components.

## 4. `SubmissionForm` recruiter row uses raw placeholders as the only labels and ad-hoc styling that drifts from the design system

- **Severity**: Medium
- **Category**: a11y / visual-consistency
- **File**: `app/features/sub_dev/SubmissionForm.tsx:42`–`49`
- **Scenario**: The recruiter quick-add row renders two `<input>`s whose sole label is `placeholder="candidate"` / `placeholder="submission repo URL"`. There are no `<label>`s, no `aria-label`s, and the placeholder vanishes on focus. The Record button is a 28px-tall (`h-7`) control with `text-micro`.
- **Root cause**: This row was hand-styled (`h-7 w-24`, `text-micro`, hard-coded English strings) instead of using the `inputClass`/labeled pattern the candidate-facing forms (`DevApplyForm`, `LiveWorkSurface`) already standardized, and unlike the rest of the context it is not internationalized.
- **Impact**: Screen-reader users get an unlabeled "edit text" field; once a value is typed the field has no visible name; the 24px touch target and micro text are below comfortable mobile/AA targets; visual inconsistency with sibling forms.
- **Fix sketch**: Add visually-hidden `<label>`s (or `aria-label`) per input, route strings through `useTranslations`, and align sizing/typography with the shared `inputClass`. Extract a small labeled-input primitive shared with the apply forms.

## 5. `EvalPanel` "strengths/concerns" two-column grid collapses illegibly on narrow widths and joins arrays into wall-of-text

- **Severity**: Medium
- **Category**: responsiveness / readability
- **File**: `app/features/sub_dev/EvalPanel.tsx:104`–`107`, `:120`–`124`
- **Scenario**: With multiple strengths/concerns, the `grid grid-cols-2` (no responsive breakpoint, no `sm:`) keeps two columns at every width, and each list is rendered as `(...).join("; ")` — a single run-on `text-micro` paragraph. On a phone or a narrow recruiter drawer the two `text-micro` columns squeeze to a few characters wide.
- **Root cause**: A fixed two-column grid with no mobile fallback, plus semantic list data flattened into a joined string rather than a `<ul>`.
- **Impact**: On small/embedded widths the strengths vs concerns become unreadable; the run-on join hurts scannability of what is the core decision content; no list semantics for assistive tech.
- **Fix sketch**: Use `grid-cols-1 sm:grid-cols-2`; render each as a real `<ul>` of `<li>`s (or comma-chips) instead of `join("; ")`. Same treatment for the `r.iterationPattern`/fluency trace line which also packs several signals into one wrapped sentence.

## 6. `CompareSubmissions` table has no caption / scope and silently renders nothing below the 2-candidate threshold

- **Severity**: Low
- **Category**: a11y / missing-empty-state
- **File**: `app/features/sub_dev/CompareSubmissions.tsx:21`, `:32`–`45`
- **Scenario**: When fewer than two evaluated submissions (or zero axes) exist, the component `return null` with no message — a recruiter expecting a comparison sees an unexplained absence. The `<table>` itself has no `<caption>`, and the per-candidate `<th>` cells lack `scope="col"`; the axis `<td>` row headers are plain `<td>` not `<th scope="row">`.
- **Root cause**: Early `return null` substitutes for an empty state, and the table omits header-association semantics.
- **Impact**: Screen-reader users navigating the comparison matrix get no row/column header association, so a cell value isn't tied to its axis/candidate; sighted recruiters get no "need ≥2 evaluated submissions to compare" hint.
- **Fix sketch**: Add a `<caption className="sr-only">`, `scope="col"` on candidate headers and `scope="row"` (as `<th>`) on the axis label cells. Render a one-line muted hint when `columns.length < 2` instead of nothing.

## 7. `ScoreBar` mount animation triggers layout-shift-style "grow" with no debounce on remount, and weight % is `aria-hidden` yet load-bearing

- **Severity**: Low
- **Category**: polish / a11y
- **File**: `app/features/sub_dev/ScoreBar.tsx:15`–`18`, `:31`, `:38`
- **Scenario**: Every `ScoreBar` starts at width 0 and animates to `score%` on each mount via `requestAnimationFrame`. Re-opening an `EvalPanel` (toggling the row) re-mounts the bars, replaying the 0→value sweep each time — a repeated "measuring" animation for data that hasn't changed. The muted weight `%` next to the label is `aria-hidden`, but it's the only place the weighting is shown visually.
- **Root cause**: Animation keyed purely on mount with no "already seen" memo; the weight % relies on `aria-label` text duplication, which is correct for SR but means the visual weight indicator and the SR string can drift if one is edited.
- **Impact**: Minor distraction / perceived sluggishness when reopening evaluations; if the `aria-label` weight phrasing and the visible `pct` diverge in future edits, SR and visual users see different weights.
- **Fix sketch**: Skip the grow animation on remount (or gate behind a one-time per-session flag / `prefers-reduced-motion`, which it already honors for the transition but still pays the reflow). Keep the weight % as the single source rendered once and referenced by `aria`.
