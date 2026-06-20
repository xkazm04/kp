# Analytics & Calibration Dashboards — UI Perfectionist scan

> Context: Funnel analytics, decision logs/records, spend and target tracking, calibration of scores, momentum/forecast/bottleneck deltas, and source analytics.
> Files reviewed: 8 of 28
> Total: 7 findings — Critical: 0, High: 3, Medium: 3, Low: 1

## 1. Calibration & decision-records error states are dead ends (no retry)

- **Severity**: High
- **Category**: error-state / missing-retry
- **File**: `app/features/sub_analytics/CalibrationPanel.tsx:86-92`, `app/features/sub_analytics/DecisionRecordsPanel.tsx:83-89`
- **Scenario**: The `/api/analytics/calibration` or `/api/decisions/records` GET fails (transient DB lock, 500, offline). `useJsonFetch` sets `error` but exposes a `reload()` these two panels never wire up.
- **Root cause**: Both panels render error as a flat `<p role="status">{t("error")}</p>` and discard the `reload` returned by `useJsonFetch`. The sibling `AnalyticsTab` error branch (`AnalyticsTab.tsx:83-95`) and `DecisionLog` both DO offer a retry button — these two diverged from the established pattern.
- **Impact**: A user who hits a transient failure on these panels is stuck on the error message until a full-page reload; the calibration/audit panels silently never recover. Inconsistent UX vs. the rest of the tab.
- **Fix sketch**: Destructure `reload` from `useJsonFetch` and render the same retry button used in `AnalyticsTab` (lines 87-93). Also `role="status"` is wrong for an error — use `role="alert"` so it's announced assertively.

## 2. Reliability diagram conveys zero data to screen readers

- **Severity**: High
- **Category**: a11y / chart-accessibility
- **File**: `app/features/sub_analytics/CalibrationPanel.tsx:29-34` (and the whole `ReliabilityDiagram`)
- **Scenario**: A screen-reader user opens the Calibration panel in the calibrated state. The SVG has `role="img"` with `aria-label={`${labels.x} / ${labels.y}`}` — i.e. only "Predicted probability / Observed advance rate". The actual data (per-bin predicted vs observed points, how far off the diagonal, the Brier value) is announced nowhere.
- **Root cause**: The chart is a pure visual encoding; the only textual equivalent is the axis names. The Brier number IS rendered as text beside it, but the dots — the entire signal of the panel — have no text alternative.
- **Impact**: Blind/low-vision users get "the chart exists" but cannot read whether the score is well-calibrated. This is the headline of an "honesty" panel, so the a11y gap defeats its purpose. WCAG 1.1.1 failure.
- **Fix sketch**: Build a descriptive `aria-label` summarizing each filled bin (e.g. "Predicted 0.7 → observed 0.62 over N samples"), or add a visually-hidden `<table>`/`<ul>` listing the bins as the accessible equivalent and mark the SVG `aria-hidden`.

## 3. Momentum bar chart rows are silent to assistive tech

- **Severity**: High
- **Category**: a11y / chart-accessibility
- **File**: `app/features/sub_analytics/AnalyticsTab.tsx:1064-1090`
- **Scenario**: SR user reaches the weekly Momentum chart. Each week `<li>` carries a rich `aria-label` (`momentumWeekAria` with added/advanced/rejected/hired counts), but the inner bar container and label span are `aria-hidden`, and the `<li>` has no `role` — a list item with an aria-label but no role does not reliably get its label announced as a standalone node across SR/browser combos.
- **Root cause**: The pattern assumes a plain `<li aria-label=…>` inside `<ol>` will read its label. In practice the label is only exposed when the element is focusable or has an appropriate role; here it is neither, so most SRs announce an empty list item.
- **Impact**: The 8-week trend (the panel's whole content) is inaudible. Same class of WCAG 1.1.1 gap as #2 but on a different chart.
- **Fix sketch**: Add `role="img"` (or `role="listitem"` is implicit — instead make each bar group an `role="img"` with the aria-label), or render a visually-hidden text summary per week. Mirroring the funnel's `role="progressbar"` approach would be consistent.

## 4. Window switch shows no loading feedback; prior cohort silently lingers

- **Severity**: Medium
- **Category**: loading-state / misleading-data
- **File**: `app/features/sub_analytics/AnalyticsTab.tsx:70-96`
- **Scenario**: User clicks "Last 30 days" / "Last 90 days". `setDays` swaps the fetch URL; `useJsonFetch` keeps the previous `data` non-null while the new request is in flight (the `!data` loading branch only fires on first mount). The whole page keeps showing all-time figures with no spinner, busy state, or dimming until the new payload lands.
- **Root cause**: The "prior data stays visible until the new payload lands" design (commented at lines 68-70) has no accompanying in-flight affordance, and `useJsonFetch` doesn't expose an `isFetching` flag.
- **Impact**: On a slow query the user sees stale all-time numbers under a pressed "30 days" chip and may read/screenshot the wrong cohort. The `aria-pressed` chip says one thing; the data says another.
- **Fix sketch**: Have `useJsonFetch` expose a `loading`/`isFetching` boolean (or track URL≠loadedUrl) and apply `aria-busy` + a subtle opacity/spinner to the grid while the new window loads, so the figures visibly belong to a pending state.

## 5. Funnel bar `role="progressbar"` misuses the ARIA pattern

- **Severity**: Medium
- **Category**: a11y / role-misuse
- **File**: `app/features/sub_analytics/AnalyticsTab.tsx:198-218`
- **Scenario**: Each funnel stage bar is `role="progressbar"` with `aria-valuenow={f.reached}` / `aria-valuemax={maxReached}`. It is wrapped in a `<Link>` (a navigation to the board). A progressbar communicates "task progress," not "N candidates reached this stage," and nesting an interactive link inside a progressbar role confuses the accessible name/role computation.
- **Root cause**: A static data bar was given a live-region progress role to get the bar semantics for free; but `progressbar` implies an updating value and pairs oddly with the surrounding link's own label.
- **Impact**: SR users hear "progressbar, X percent" for what is a hiring-funnel count and a navigable link — a misleading affordance. The bar is also decorative given the link already has a full `aria-label`.
- **Fix sketch**: Drop `role="progressbar"` (and its `aria-value*`) on the inner bar, mark it `aria-hidden`, and rely on the `<Link>`'s `aria-label` which already states stage + reached + conversion. Reserve `progressbar` for genuine progress.

## 6. Per-stage dwell, archetype, and source bars have no min-width / zero-state polish

- **Severity**: Medium
- **Category**: zero-data-state / visual
- **File**: `app/features/sub_analytics/AnalyticsTab.tsx:297-300` (archetype), `446` (automation split), `1083` (momentum bar height)
- **Scenario**: A series with a real but tiny value (e.g. `advanceRatePct = 1`, or a momentum week with 1 event against a max of 50) renders a bar `width:1%` / `height:2%` — a visually invisible sliver indistinguishable from the empty `bg-paper` track, so "1" reads as "0".
- **Root cause**: Widths/heights are a raw `value/max*100` with no floor; only the literal-zero case is styled (empty-state text), not the near-zero case.
- **Impact**: Misleading chart — small-but-nonzero cohorts look like no data, which on an analytics surface is a correctness problem, not just polish.
- **Fix sketch**: Apply a `Math.max(2, …)` (or `min-width: 2px`) floor to any nonzero bar so a present-but-small value is always visible, matching how the funnel already shows the numeric count inside the bar.

## 7. Inline spend/target save failure is hard to discover and not announced

- **Severity**: Low
- **Category**: error-feedback / a11y
- **File**: `app/features/sub_analytics/AnalyticsTab.tsx:824-847` (`InlineNumberSave`)
- **Scenario**: A spend or goal save POST fails (or input is negative/non-finite). The only feedback is a coral border + a native `title` tooltip + `aria-invalid`. There is no visible inline message and nothing in a live region, so a sighted user on touch (no hover → no `title`) and an SR user get almost no signal that their edit was rejected.
- **Root cause**: Failure state relies on `title` (hover-only, unreliable on mobile) and a border-color change (fails color-contrast-as-sole-indicator guidance).
- **Impact**: Users believe their cost-per-hire spend or conversion goal saved when it didn't; the cost columns silently keep the old denominator.
- **Fix sketch**: Render a small inline `<span role="alert">` with the failure text next to the input when `failed`, alongside the existing border/`aria-invalid`, so the rejection is both visible and announced without depending on hover.
