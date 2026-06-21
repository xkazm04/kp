# Analysis Result Panels — UI Perfectionist scan

> Context: Result panels that render a completed candidate analysis (score, salary, factors, compare, soft signals).
> Files reviewed: 19 of 24
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Compare tab is entirely un-localized in a bilingual app
- **Severity**: High
- **Category**: i18n
- **File**: `app/_components/results/compare/CompareTab.tsx:57` (+82–94,103,137–157,173,183,200,216,267); driver text `app/_lib/comparison.ts:109-146`
- **Scenario**: A Czech-language report is open; user selects the Compare tab and the whole panel flips to English.
- **Root cause**: Every other result panel calls `useTranslations("report")`; CompareTab hardcodes "CV Variant Comparison", "Overall", "Recommended:", "baseline", "Years experience", etc., and `comparison.ts` builds driver sentences in English.
- **Impact**: Localized reports break to English on this tab; unprofessional in a bilingual product.
- **Fix sketch**: Add `useTranslations`, move literals to `messages.*.report.compare.*`, and template the driver prose (or generate it server-side in the recruiter's language).

## 2. `aria-controls` on each tab points at a panel id that doesn't exist
- **Severity**: High
- **Category**: a11y
- **File**: `app/_components/results/ResultPanel.tsx:149,164`
- **Scenario**: Screen-reader user tabs through the result tabs.
- **Root cause**: Each `role="tab"` sets `aria-controls={panel-${tab.id}}`, but only one tabpanel renders with id `panel-${activeTab}`, so 4–5 tabs reference a non-existent element (WCAG 4.1.2).
- **Impact**: Broken tab/panel association for assistive tech.
- **Fix sketch**: Give the single panel one stable id and point every tab at it, or render one hidden `role="tabpanel"` per tab.

## 3. DispositionEditor loses an in-flight note on unmount
- **Severity**: High
- **Category**: data-loss
- **File**: `app/_components/results/DispositionEditor.tsx:81-85`
- **Scenario**: A recruiter types a disposition reason then immediately closes the report.
- **Root cause**: The 800ms autosave effect's cleanup runs `clearTimeout` on unmount, cancelling the only pending PATCH; `onBlur` doesn't fire on unmount — despite the comment claiming unmount is protected.
- **Impact**: The reason is silently dropped.
- **Fix sketch**: A mount-once effect that flushes a `noteRef` via `keepalive` fetch/`sendBeacon` on unmount.

## 4. SalaryGauge marker labels overlap and overflow at extremes
- **Severity**: Medium
- **Category**: layout
- **File**: `app/_components/results/salary/SalaryGauge.tsx:89-115`
- **Scenario**: Target salary ≈ midpoint or ≈ 100% of the band.
- **Root cause**: "Mid" and "+30%" are absolute, `-translate-x-1/2`-centered on their percents; when target ≈ midpoint they overprint, and at `targetPct ≈ 100%` "+30%" overflows the bar's right edge.
- **Impact**: Overlapping/overflowing labels misread the salary position.
- **Fix sketch**: Detect proximity and offset one label; clamp label `left` into a `[6%,94%]` inset.

## 5. FactorChart axis/tooltip text is hardcoded English
- **Severity**: Medium
- **Category**: i18n
- **File**: `app/_components/FactorChart.tsx:35-39,62`
- **Scenario**: Localized report viewing the factor breakdown chart.
- **Root cause**: Bars "Experience/Skills/Role/Education/Traits" and tooltip "Points" are literals under a localized heading.
- **Impact**: Mixed-language chart in a localized report.
- **Fix sketch**: Source labels from the localized score-taxonomy catalog; localize "Points".

## 6. Compare table lacks caption + header scope; winner is color-only
- **Severity**: Medium
- **Category**: a11y
- **File**: `app/_components/results/compare/CompareTab.tsx:99-161`
- **Scenario**: Screen-reader / color-blind user reads the comparison table.
- **Root cause**: No `<caption>`, no `scope="col"`, row labels are `<td>` not `<th scope="row">`, and the winning column is signalled only by `text-coral` + an `aria-hidden` Crown (WCAG 1.3.1/1.4.1).
- **Impact**: Table semantics and the "winner" signal are inaccessible.
- **Fix sketch**: Add sr-only caption, `scope` attributes, `<th scope="row">`, and sr-only "Winner" text.

## 7. Copy buttons have no announced feedback and silently no-op on failure
- **Severity**: Low
- **Category**: a11y / error-handling
- **File**: `app/_components/results/shared.tsx:175-195` and `app/_components/results/interview/SoftSignalsSection.tsx:33-41`
- **Scenario**: User clicks Copy; clipboard write fails or succeeds.
- **Root cause**: Success is an icon swap with no `aria-live`; on clipboard failure nothing changes.
- **Impact**: No feedback for SR users; silent failures.
- **Fix sketch**: Add a visually-hidden `aria-live` status and an inline error on the `false` path, consolidated into shared `ListBlock`.
