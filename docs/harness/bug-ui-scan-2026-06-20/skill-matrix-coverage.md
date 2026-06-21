# Skill Matrix & Coverage — UI Perfectionist scan

> Context: The candidate↔skill fit matrix view and the About/coverage explainer that maps features to the pipeline (incl. student mode).
> Files reviewed: 7 of 8
> Total: 7 findings — Critical: 0, High: 2, Medium: 4, Low: 1

## 1. Fit floor / family filter can blank the grid with no empty state
- **Severity**: High
- **Category**: missing-empty-state
- **File**: `app/features/sub_matrix/MatrixTab.tsx:548` (render gate) and `:166-186` (`rows` filter), `:174` (minFit filter)
- **Scenario**: A recruiter sets the min-fit floor to `≥70` (or `≥55`) on a pool where no candidate's best visible score clears it. `rows` becomes `[]` but `data.candidates.length > 0`, so the empty-grid branch (`data.candidates.length === 0 || data.positions.length === 0`) is NOT taken.
- **Root cause**: The empty-state gate checks the raw dataset size, not the *post-filter* `rows.length`. The fit-floor and column-sort filters can legitimately reduce `rows` to zero while data exists.
- **Impact**: The table renders with sticky headers, full column-stats strips, and a completely empty `<tbody>` — a "broken/blank result" that reads as a bug, with no message and no way to learn the floor is the cause. The count pill still says e.g. "0 of 42 candidates", which is the only (easily-missed) hint.
- **Fix sketch**: Add a branch before the `<table>`: when `rows.length === 0 && data.candidates.length > 0`, render an inline notice ("No candidates clear the ≥70 fit floor") with a button that calls `setMinFit(0)` / clears `sortCol`. Reuse the amber-notice styling already used for `missing`/`missingCandidates`.

## 2. Long-running matrix load shows bare text, no skeleton — layout shift on arrival
- **Severity**: High
- **Category**: missing-loading-state
- **File**: `app/features/sub_matrix/MatrixTab.tsx:534-535` (`!data` → `<p>{t("computing")}</p>`), backed by `app/api/matrix/route.ts:88-98` (Python subprocess spawn)
- **Scenario**: First visit (or any cache miss) spawns `pipeline.jobfit.matrix_cli` as a Python subprocess and scores an O(N×M) grid for up to 200 profiles. During that multi-second wait the user sees only a one-line "Computing…" sentence; when data lands a full sticky-header table + per-column histograms pop in.
- **Root cause**: The loading branch is a text placeholder with none of the eventual layout reserved, so there's a large CLS jump and no progress affordance for a known-slow operation.
- **Impact**: Feels frozen on the slowest path in the tab; the header controls (sort/min-fit/shortlist/export) are also absent until load, so the whole surface visibly reflows. Poor perceived performance on exactly the first impression.
- **Fix sketch**: Render a skeleton table (a few greyed header cells + ~6 shimmer rows at the real `h-9` cell height) in the `!data` branch so the grid's footprint is reserved, matching the loading-skeleton pattern used elsewhere in the app.

## 3. About students tablist is not a complete ARIA tab pattern (no panel wiring / arrow-key nav)
- **Severity**: Medium
- **Category**: a11y
- **File**: `app/features/sub_about/StudentsAbout.tsx:34-49` (tablist) and `:51-59` (panel)
- **Scenario**: A keyboard/screen-reader user lands on the "Overview / Example scoring / Interview script" tabs. The buttons declare `role="tab"` + `aria-selected`, but the content `<div>` has no `role="tabpanel"`, no `id`, and the tabs carry no `aria-controls`. There is also no roving-tabindex / ArrowLeft-ArrowRight handling — the WAI-ARIA tab keyboard contract.
- **Root cause**: The tab visuals were built without the associated panel semantics and keyboard model that `role="tab"` implies.
- **Impact**: Screen readers announce three "tab" controls whose selection isn't linked to any panel; the panel change isn't conveyed. Keyboard users get no arrow-key tab traversal, only Tab-through-each-button. Declaring `role="tab"` without the rest is worse than plain buttons because it sets an unmet expectation.
- **Fix sketch**: Give the panel `role="tabpanel"`, an `id`, and `aria-labelledby` the active tab; give each tab `id` + `aria-controls` the panel; add `tabIndex={active ? 0 : -1}` and an `onKeyDown` for Arrow/Home/End. Consider extracting a shared `<Tabs>` primitive (the matrix popover and other tabbed panels would reuse it).

## 4. Disabled matrix cells in select mode hide their reason from keyboard users
- **Severity**: Medium
- **Category**: a11y
- **File**: `app/features/sub_matrix/MatrixTab.tsx:626-636` (`disabled={selectMode && !selectable}`, reason carried only in `title`)
- **Scenario**: In shortlist (select) mode, every blocked or already-in-pipeline cell is rendered as a `disabled` `<button>` whose explanation ("blocked: language" / "already in pipeline") lives only in the `title` attribute.
- **Root cause**: `disabled` removes the element from the tab order, and `title` tooltips are unreachable by keyboard and most touch devices — so the only channel carrying *why a cell can't be selected* is doubly inaccessible.
- **Impact**: A keyboard or touch recruiter in select mode cannot discover why a given candidate↔role pair is unselectable; the grid silently refuses interaction with no perceivable reason. Many cells in a realistic pool are blocked, so this is widespread.
- **Fix sketch**: Prefer `aria-disabled="true"` + an `onClick` no-op over the native `disabled` so the cell stays focusable and its `aria-label` (which already names the reason) is announced; or surface the blocked reason as visible text/icon rather than a hover-only `title`.

## 5. Color- and tooltip-only encoding: archetype dots and column histograms
- **Severity**: Medium
- **Category**: a11y
- **File**: `app/features/sub_matrix/MatrixTab.tsx:597` (archetype dot — color + `title` only) and `app/features/sub_matrix/MatrixShared.tsx:43-51` (histogram bars `aria-hidden`, info only in the wrapper `title`)
- **Scenario**: A recruiter scans rows by archetype (a 2.5px colored dot) and columns by the 5-bar distribution strip. The dot's meaning is conveyed purely by `bg-*` color plus a hover `title`; the histogram's bars are `aria-hidden` and the best/median/strong numbers are present as text but the distribution shape is `title`-only.
- **Root cause**: Glanceable encodings were given a `title` tooltip as their sole non-visual fallback; color is the only difference between archetypes for sighted users who don't hover.
- **Impact**: Color-blind users can't distinguish `bg-steel` / `bg-coral` / `bg-moss` dots, and the fallback `bg-stone-400` for unknown archetypes is indistinguishable from a configured one without hovering. Keyboard/touch users can't reach the `title`. The strong-fit `★` pill (line 600-606) is good precedent — apply the same visible-token approach to the dot.
- **Fix sketch**: Add a short visible archetype glyph/abbreviation beside the dot (or vary shape, not just hue), and give the histogram a concise `aria-label` summarizing the distribution; keep the numeric best/median/strong text already shown.

## 6. Bulk-add runs sequentially with no per-row progress; only a terminal banner
- **Severity**: Medium
- **Category**: missing-progress-feedback
- **File**: `app/features/sub_matrix/MatrixTab.tsx:273-319` (`addSelected` loop) and `:451` (button shows only "Adding…")
- **Scenario**: A recruiter selects 20+ cells and clicks "Add N". `addSelected` awaits `postPipelineAdd` one cell at a time in a `for…of` loop; the only feedback is the button label flipping to "Adding…" until the whole batch finishes.
- **Root cause**: The optimistic per-cell ring (`added`) is only committed after the *await resolves per item*, but there's no aggregate progress indicator, so a long batch looks stalled mid-run.
- **Impact**: For a large selection the UI appears hung for several seconds with no "3 of 20" counter; a user may re-click or navigate away (the loop has no abort), and partial successes aren't visually distinguished from a stuck state until the end.
- **Fix sketch**: Drive a running counter (e.g. `setAnnounce`/a visible "Adding 3 of 20…") inside the loop, and update each cell's ring as its own promise resolves (cells already key by `candId|posId`). Optionally disable navigation or guard against double-submit while `adding`.

## 7. Header control cluster has no responsive collapse; count pill + filter chips crowd on narrow widths
- **Severity**: Low
- **Category**: responsiveness
- **File**: `app/features/sub_matrix/MatrixTab.tsx:358-419` (header control row) and `:346` (`flex-wrap` only)
- **Scenario**: On a tablet/narrow window the header packs a count pill, a 3-segment min-fit control, a sort toggle, a shortlist toggle, and an export button. They `flex-wrap` but each is full-size, so they stack into several ragged rows and the `≥55/≥70` segmented control sits oddly beside the wrapping count line.
- **Root cause**: The control bar relies solely on `flex-wrap` with no breakpoint strategy (no overflow menu, no icon-only collapse) for what is a dense toolbar.
- **Impact**: Cluttered, hard-to-scan header on smaller screens; the primary grid is pushed down. Cosmetic but degrades the "every pixel matters" polish on non-desktop widths.
- **Fix sketch**: At `< lg`, collapse secondary actions (export, sort) into an overflow "⋯" menu or switch them to icon-only buttons with `aria-label`, and keep only the count + min-fit primary; reuse the app's existing toolbar/overflow pattern if one exists.
