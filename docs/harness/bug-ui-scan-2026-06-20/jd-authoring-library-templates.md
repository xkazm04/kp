# JD Authoring Library & Templates — UI Perfectionist scan

> Context: Author, lint, version and render job descriptions from reusable templates (Library tab, JD builder, template manager, public JD detail pages).
> Files reviewed: 9 of 26
> Total: 7 findings — Critical: 0, High: 2, Medium: 4, Low: 1

## 1. Duplicate / Ingest buttons strand in an `error` label with no recoverable affordance and no announcement

- **Severity**: High
- **Category**: error-state / a11y / silent-failure
- **File**: `app/features/sub_library/LibraryTab.tsx:140-156` (`IngestAsJobButton`), `app/features/sub_library/LibraryTab.tsx:165-194` (`DuplicateJdButton`)
- **Scenario**: A recruiter clicks "Duplicate" (or "Ingest as job") on a saved JD row and the fetch fails (network blip, 500, body fetch returns no `body`). The only feedback is the button label swapping to `t("duplicateRetry")` / `t("ingestRetry")`.
- **Root cause**: The failure is communicated solely by mutating the button's own text. There is no `role="alert"`/`aria-live` region, no error text, and nothing tells a screen-reader user the action failed — the label just quietly changes. `DuplicateJdButton` also throws away the real reason (catch is bodyless) so even sighted users get no "why".
- **Impact**: Failures are easy to miss in a list of rows; SR users get no feedback at all. Recruiters can believe a clone happened when it didn't (data they think exists is absent), and there's no inline reason to act on.
- **Fix sketch**: Add a small `role="status"`/`aria-live="polite"` error line per row (mirror the `CandidatesSection` failed branch which already does this well) and keep the distinct retry label. Surface the actual error message from the failed response instead of a generic relabel.

## 2. Public JD body renders nothing for an empty/whitespace markdown — blank shareable page

- **Severity**: High
- **Category**: missing-empty-state
- **File**: `app/jds/[slug]/JdBody.tsx:20-35`, also `app/features/sub_library/JdBuilderResult.tsx:333-337`
- **Scenario**: A JD is saved/edited down to an empty or whitespace-only body (the `JdActions` editor and `LibraryJdForm` both allow a body that passes the length cap but can be visually empty after markdown strips), then the public `/jds/[slug]` page is shared.
- **Root cause**: `JdBody` (and the builder's preview tabpanel) pass `markdown` straight to `<Markdown content={markdown} />` with no empty/blank guard. The page header, Apply CTA and copy button all render around a content card that is visually empty.
- **Impact**: A candidate following a shared link sees a polished header and an Apply button above a blank white card — looks broken/untrustworthy on the flagship public artifact. The "Copy as Markdown" button also copies an empty string with a success checkmark.
- **Fix sketch**: When `markdown.trim()` is empty, render a muted placeholder ("This description has no content yet.") in `JdBody`, and disable the copy button. Apply the same guard to the builder preview tabpanel.

## 3. "Source into Pipeline" success/warning banners replace the editor's own error and saved-state controls

- **Severity**: Medium
- **Category**: interaction-correctness / state-shadowing
- **File**: `app/features/sub_library/JdBuilderResult.tsx:342-415`
- **Scenario**: After saving a draft, the recruiter clicks "Source into Pipeline". The render branches on `sourceResult` FIRST (`sourceResult ? … : saved ? … : …`), so once sourcing returns, the `saved` block (Source button, draft badge, ingest-retry affordance) disappears entirely and is swapped for the success/warning band.
- **Root cause**: The three-way ternary makes `sourceResult` mutually exclusive with the `saved` action cluster. There is no path back to re-source, re-open the draft badge, or retry an ingest after the first sourcing attempt — the controls vanish.
- **Impact**: If sourcing reports a warning (`sourced 0` / partial), the user can read the warning but has lost the button to retry sourcing without regenerating. The draft identity badge also disappears, reducing traceability of what was just created.
- **Fix sketch**: Render the `saved` action cluster and the `sourceResult` banner together (banner below, not instead of) so the draft badge and a re-source affordance remain available after the first attempt.

## 4. Builder market-salary `confidence` value rendered raw, with no visual hierarchy from the figure

- **Severity**: Medium
- **Category**: visual-consistency / i18n
- **File**: `app/features/sub_library/JdBuilderResult.tsx:231-234`
- **Scenario**: The salary band pill renders `{formatSalaryRange(...)} · {s.confidence}` where `s.confidence` is the raw model/string value (e.g. `high`, `medium`). It is dropped inline with no styling distinction, no capitalization, and no translation through the enum/catalog layer the rest of the builder uses (`useEnumLabel`).
- **Root cause**: The confidence token is interpolated directly rather than mapped to a labeled, styled chip (the source provenance right beside it IS carefully mapped through `salarySourceKey` + `t()`, so this is inconsistent within the same component).
- **Impact**: In a Czech-locale JD the confidence word stays English; the value reads as an unstyled afterthought next to a formatted currency range, weakening the band's credibility and breaking the localization promise (JDL5 output-language feature).
- **Fix sketch**: Map `s.confidence` through a small `Record<confidence, key>` + `t()` (mirror `salarySourceKey`) and render it as a subtle chip/badge so the figure stays primary and the label localizes.

## 5. Template manager and library list mix duplicated empty/error/skeleton patterns instead of shared primitives

- **Severity**: Medium
- **Category**: component-extraction
- **File**: `app/features/sub_library/JdTemplateManager.tsx:145-156`, `app/features/sub_library/LibraryTab.tsx:301-304,382-398`, `app/features/sub_library/JdBuilderResult.tsx` (lint all-clear/finding blocks)
- **Scenario**: Three list surfaces (saved JDs, candidates section, templates) each hand-roll their own `null = loading skeleton / [] = empty note / error` triad with bespoke skeleton markup — the JD list uses the shared `Skeleton` component, but the template manager hand-codes `animate-pulse` bars, and the candidates section uses plain text for loading.
- **Root cause**: No shared `<ListState loading empty error>` (or skeleton-row) primitive, so each surface reinvents the same three states with drifting visuals (real `Skeleton` vs inline `animate-pulse` vs text).
- **Impact**: Visual inconsistency between sibling lists in the same feature, and future state-handling fixes (like finding #1) must be applied N times. Loading the template manager looks different from loading the JD list.
- **Fix sketch**: Extract a `SkeletonRows`/`ListStates` helper that renders the loading/empty/error triad with the design-system `Skeleton`, and use it in all three places.

## 6. JD detail "Publish to job boards" is a permanently-disabled control that still looks like a primary action

- **Severity**: Medium
- **Category**: misleading-affordance
- **File**: `app/jds/[slug]/page.tsx:127-134`
- **Scenario**: Every visitor to a public JD page (including candidates, before `canManage` gates anything — this button is outside the `canManage` block, in the header) sees a "Publish to job boards" button styled as a full bordered control with an icon, permanently `disabled` with `cursor-not-allowed` and a tooltip saying "coming soon".
- **Root cause**: A not-yet-built feature is shipped as a dead, always-disabled button in the page header rather than hidden behind a flag or omitted. Its only explanation is a hover `title` (invisible on touch and to keyboard/SR users).
- **Impact**: Candidates and recruiters see a prominent control that never works; the "coming soon" rationale is unreachable on mobile/keyboard. Adds clutter and a broken-affordance impression to the flagship public page.
- **Fix sketch**: Hide the button entirely until the integration exists (or gate it to `canManage` with a visible "Coming soon" badge instead of a tooltip-only explanation), so candidates don't see a dead primary-looking control.

## 7. Template-switch confirm warning is not focus-managed and can be missed below the fold

- **Severity**: Low
- **Category**: a11y / focus-management
- **File**: `app/features/sub_library/JdBuilder.tsx:225-246`
- **Scenario**: After hand-editing a generated JD, the recruiter changes the template `<select>`. A destructive-action confirm band (`role="group"`) appears between the selector and the (potentially long) result body. Focus stays on the `<select>`; only the "Keep editing" button is `autoFocus`'d — but the warning text announcing *why* is not tied to the select via `aria-describedby` and the `role="group"` isn't `role="alert"`/`aria-live`.
- **Root cause**: The staged-switch warning relies on visual proximity to the select. A keyboard/SR user who changes the select hears the new option but gets no announcement that the change was gated and that a confirm is now required.
- **Impact**: A screen-reader user may believe the template switched (it didn't — it's staged) or not discover the confirm at all, and the warning can be scrolled out of view on a tall result. Mild but real for the destructive "replace edits" path.
- **Fix sketch**: Give the warning band `role="alert"` (or `aria-live="assertive"`) so it's announced on appearance, and wire `aria-describedby` from the `<select>` to the warning text. The existing `autoFocus` on "Keep editing" is good — keep it.
