# CV Analysis Workspace — UI Perfectionist scan

> Context: Drop, paste, or upload a CV and a target JD, then run a full AI analysis. Drives the Analyze tab intake, file routing, and the analysis run lifecycle.
> Files reviewed: 17 of 31
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Live analysis progress UI is 100% hardcoded English in a bilingual app
- **Severity**: High
- **Category**: i18n / visual-consistency
- **File**: `app/_components/AnalysisProgress.tsx:26-51` (STAGE_LABEL), `:99-143` (headlines + "Progress" + "Cancel scan")
- **Scenario**: A Czech recruiter runs an analysis. The entire surrounding workspace is translated via `next-intl` (`useTranslations("analyze")`), and the form even has a per-run report-language selector. The moment they click Analyze, the whole progress panel — "Extracting CV text", "Calling Gemini", "Almost there — packaging your report", "Live pipeline", "Progress", "Cancel scan", the per-variant "Comparing N CV variants in parallel." line — renders only in English.
- **Root cause**: `STAGE_LABEL`, the headline strings, the eyebrow, the metric label, and the cancel button are string literals baked into the component instead of message keys. Every sibling in `sub_analyze/` already pulls from the `analyze` namespace.
- **Impact**: The single most prominent, longest-lived screen of the flow (Gemini is "the longest step") is untranslated, breaking the bilingual contract precisely where the user is waiting and watching. Reads as a half-localized product.
- **Fix sketch**: Move all `STAGE_LABEL` title/subtitle pairs and the headline/eyebrow/progress/cancel strings into the `analyze` (or a new `progress`) message namespace; have `AnalysisProgress` call `useTranslations`. Pluralize the "N variants" line with ICU.

## 2. Column status labels ("Required"/"Optional"/"N variants"/"N chars") bypass i18n
- **Severity**: High
- **Category**: i18n / silent-inconsistency
- **File**: `app/features/sub_analyze/useAnalyzeForm.ts:82-100`
- **Scenario**: Same Czech recruiter: each `AnalyzeColumn` header renders an `attached` filename/size pill from these statuses, but `cvStatus` returns `label: "Required"`, the JD/company/GitHub columns return `"Optional"`, and the multi/char states return `` `${n} variants` `` / `` `${n} chars` `` — all English literals constructed in the hook.
- **Root cause**: `ColumnStatus.label` is built with raw strings in the hook (a non-component file with no `t`), while `AnalyzeColumn` itself is fully translated. The translated `required`/`optional` tag in `AnalyzeColumn.tsx:42` and these untranslated status labels can therefore disagree on screen.
- **Impact**: Mixed-language chips inside an otherwise localized card; the `"N chars"` / `"N variants"` strings also won't pluralize correctly in either language.
- **Fix sketch**: Return a structured status (`{ tone, key, params }`) from the hook and resolve the label with `t()` inside `AnalyzeColumn`, or pass the count and let the component format it. Reuse the existing `cvVariants` / `charsCount` keys already defined for other surfaces.

## 3. CV add is async (content-hash dedupe) but the UI gives zero pending feedback and can double-fire
- **Severity**: High
- **Category**: missing-loading-state / interaction-correctness
- **File**: `app/features/sub_analyze/AnalyzeProfileInput.tsx:19,37-43`, `app/features/sub_analyze/useAnalyzeForm.ts:110-142`
- **Scenario**: A user clicks "Add variant" (or drops a second CV). `addCvFile` awaits `isDuplicateCvVariant` (a `crypto.subtle` digest) before the file appears. On a large PDF or slow device there is a visible gap with no spinner, no disabled control, and no optimistic row — the user, seeing nothing, clicks/drops again.
- **Root cause**: `AnalyzeProfileInput` types `onAdd: (file: File) => void` and fires it as fire-and-forget, discarding the Promise the hook actually returns. There is no per-add busy state (unlike `loadSample`, which has `isLoadingSample`). The hook serializes intake correctly server-of-truth-wise, but the UI never reflects "working".
- **Impact**: Perceived dead control during hashing; repeated clicks queue redundant work and can briefly exceed the visual variant count before the cap settles. Layout feels unresponsive at the exact moment the user is composing a best-of-N comparison.
- **Fix sketch**: Type `onAdd` as `=> Promise<void>`, track an `isAdding` state around the await, and disable the Add label + show `ScanAnimationCompact` while it resolves (mirror the `loadSample` pattern already in this file).

## 4. Drag-anywhere overlay is `aria-hidden` and never announced to assistive tech
- **Severity**: Medium
- **Category**: a11y
- **File**: `app/features/sub_analyze/AnalyzeProfileInput.tsx:52-66`
- **Scenario**: A screen-reader / low-vision user drags a CV onto the page. A full-window coral overlay ("Drop your CV anywhere") appears for sighted users, but it carries `aria-hidden` and sits outside any live region, so AT users get no signal that a drop target is active or where it routes.
- **Root cause**: The overlay is treated as purely decorative (`aria-hidden`), and the drag state (`isWindowDragging`) is not mirrored into any `aria-live="polite"` status. The carve-out helper text ("labeled zones own their drops") is likewise hidden.
- **Impact**: The flagship "drop anywhere" affordance is invisible to AT; combined with the keyboard-only path being the hidden file input, the routing rules are undiscoverable non-visually.
- **Fix sketch**: Keep the visual overlay `aria-hidden`, but render a visually-hidden `aria-live="polite"` region that announces "Drop a CV anywhere to add it" while `isWindowDragging`. Ensure the keyboard `<label htmlFor>` upload path is documented in the empty-state helper.

## 5. Whole progress panel is a `role="status"` live region wrapping an interactive Cancel button
- **Severity**: Medium
- **Category**: a11y / role-misuse
- **File**: `app/_components/AnalysisProgress.tsx:103-145`
- **Scenario**: During a scan, the entire panel is `role="status" aria-live="polite"`, and the "Cancel scan" `<button>` lives inside it. Every stage tick mutates children of the live region, so screen readers re-announce large chunks of the panel (headline, percent, six stage rows) on each ~1.8s fake tick — and an interactive control sits inside a region meant for passive status text.
- **Root cause**: The live region is scoped to the whole card rather than to a small text node (e.g. just the headline + percent). Interactive elements should not be nested in an `aria-live` status container.
- **Impact**: Verbose, repetitive announcements; the focusable Cancel button inside a status region is an unexpected pattern. CLS-adjacent: the stage grid re-renders constantly while announced.
- **Fix sketch**: Narrow `role="status"`/`aria-live` to a small inner element holding just the current stage title + percent; move the Cancel button and the static stage `<ol>` outside the live region (the `<ol>` rows convey their own state visually + via icon).

## 6. Paste-row preview collapses on `onBlur`, so clicking its own Edit/Clear can race the collapse
- **Severity**: Medium
- **Category**: interaction-correctness / polish
- **File**: `app/features/sub_analyze/AnalyzePasteRow.tsx:21-49`
- **Scenario**: A user pastes a JD, clicks Edit to expand the textarea, edits, then clicks the inline "Clear" (X) or Edit button. The textarea's `onBlur` sets `isEditing=false` and swaps the textarea (`h-24`) for the 1-row preview at the same moment the user is clicking a control whose position is shifting — a layout jump under the cursor, and on slower paint the click can land on the wrong target.
- **Root cause**: Collapse is driven purely by `onBlur` with no relatedTarget guard; the editing/preview swap changes element height (`rows={showTextarea ? 4 : 1}` plus `h-24` vs `h-auto`) causing CLS exactly during an interaction.
- **Impact**: Mis-clicks and a visible vertical jump when leaving the editor; the two states differ in height enough to shove the Analyze button/row below.
- **Fix sketch**: On blur, ignore the collapse when `event.relatedTarget` is one of the row's own buttons; reserve a min-height so the preview/editor swap doesn't change card height. Consider an explicit "Done" affordance instead of blur-to-collapse.

## 7. GitHub column has no inline validation/empty parity and no error/loading affordance
- **Severity**: Low
- **Category**: missing-states / visual-consistency
- **File**: `app/features/sub_analyze/AnalyzeForm.tsx:141-168`
- **Scenario**: A recruiter types a malformed handle (`https://github.com/foo/bar`, a full URL, or trailing spaces) into the GitHub field. Unlike the JD/Company columns — which have drop zones, attached-pills, and inline `role="alert"` rejection rows — the GitHub field accepts any string with no format hint, no inline validation, and no in-column loading/error state (the deep-dive's loading/error only surfaces later in the result panel).
- **Root cause**: The GitHub cell is a bare `<input>` with a helper line; it does not participate in the column's status/error vocabulary the sibling columns share, and there is no client-side handle normalization before `launchGithubRun`.
- **Impact**: Inconsistent column weight and feedback; a typo'd handle produces a delayed, opaque failure instead of an instant inline correction, undercutting the GH3 "GitHub handle alone is a valid run" feature.
- **Fix sketch**: Normalize/validate the handle on change (strip a pasted URL down to the username, trim) and show an inline hint row in the same `text-coral role="alert"` style the other columns use; optionally reflect the deep-dive `loading`/`error` status as the column's `status` pill for parity.
