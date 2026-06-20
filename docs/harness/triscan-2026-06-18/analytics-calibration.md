# Analytics & Calibration Dashboards — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 1 High / 4 Medium / 0 Low
> Lens: 2 bug / 2 ui / 1 biz

## 1. Windowed cost-per-applicant / cost-per-hire divides ALL-TIME spend by a WINDOWED cohort
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Spend attribution / divide-mismatch
- **Value**: impact 8/10 · effort 3/10 · risk 2/10
- **File**: `app/_lib/db/analytics.ts:409-422`
- **Scenario**: An org spent 300,000 CZK on a channel over its lifetime and entered that figure once via the spend input. A recruiter then switches the analytics window to "Last 30 days," in which that channel produced 10 applicants and 0 hires. The Channel Economics table shows cost-per-applicant = 30,000 CZK (300,000 / 10) and the lifetime CPA is silently mixed with a 30-day denominator.
- **Root cause**: `listChannelSpend()` (`channels.ts:136`) returns a single all-time `amount_czk` per channel with no window parameter, but `m.total` and `m.hired` are computed from `rows`, which are scoped to the `windowDays` cohort (`cutoffIso`/`upperIso` SELECT at `analytics.ts:131-133`). `costPerApplicantCzk = spendCzk / m.total` and `costPerHireCzk = spendCzk / m.hired` therefore mix a lifetime numerator with a windowed denominator.
- **Impact**: The headline economics number — the one a buyer uses to decide where to spend ad budget — is inflated by the ratio of (lifetime months / window months). The more mature/longer-running the account, the more wrong it gets, so the metric is least trustworthy for the best customers.
- **Fix sketch**: Either (a) scope spend to the window: store spend with a date and sum only spend in `[cutoffIso, upperIso)`, or (b) if spend stays a single lifetime figure, only compute CPA/CPH in the all-time view (`windowDays == null`) and render "—" with a tooltip otherwise. (a) is the correct long-term answer; (b) is the safe immediate guard.

## 2. Momentum bars have no minimum height — small nonzero weeks render as visually empty
- **Lens**: 🎨 UI Perfectionist (primary)
- **Severity**: Medium
- **Category**: Chart legibility / hand-rolled bars
- **Value**: impact 6/10 · effort 2/10 · risk 1/10
- **File**: `app/features/sub_analytics/AnalyticsTab.tsx:1018`
- **Scenario**: A week with 1 hire sits in a span whose busiest week added 60 candidates. The hire bar height is `round((1/60)*100)% = 2%` of a 5rem column — roughly 1.6px — indistinguishable from the zero-height bars beside it. The recruiter reads "no hires that week" when there was one.
- **Root cause**: `style={{ height: `${Math.round((w[s.key] / max) * 100)}%` }}` with no floor. A nonzero count that is tiny relative to `max` rounds to a sub-pixel sliver; there is no `min-height` and no per-bar count label except the `title` tooltip (invisible on touch and at a glance).
- **Impact**: The momentum panel is the page's only trend visual; under-rendering the rare-but-critical events (hires, rejects in a low-volume week) is precisely the signal a recruiter watches for. It quietly understates pipeline activity for any spiky/low-volume series.
- **Fix sketch**: Clamp nonzero bars to a visible floor, e.g. `height: value === 0 ? '0' : `max(${pct}%, 3px)`` (Tailwind `min-h-[3px]` on a conditional class). Optionally render the count above the tallest bar in each week so the exact value is legible without hover.

## 3. All-time forecast multiplies a recent-8-week velocity by a lifetime conversion rate
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Medium
- **Category**: Forecast math on mismatched horizons
- **Value**: impact 6/10 · effort 4/10 · risk 3/10
- **File**: `app/_lib/analytics-forecast.ts:50-71` (+ `app/_lib/db/analytics.ts:280`)
- **Scenario**: In the all-time view, `momentum` is the trailing `MOMENTUM_WEEKS` (8) buckets, so `weeklyVelocity = mean(last 8 weeks of inflow)`. But `funnel.reached` is computed over the ENTIRE history, so `overallConversion = hiredReached / firstReached` is the lifetime conversion. The projection `weeklyVelocity × weeks × overallConversion` blends a recent inflow rate with an all-time conversion — fine if conversion is stationary, misleading after any funnel change (new screening bar, a hiring freeze that lifted, a campaign that changed candidate quality).
- **Root cause**: The two inputs are scoped to different time horizons. `weeklyAdded` is always the recent momentum series (`AnalyticsTab.tsx:833`), while `funnel` reflects whatever window the page is in — and in all-time that is the full history. There is no recency weighting or windowing alignment between velocity and conversion.
- **Impact**: A forecast is an upsell/retention surface ("we'll project your hires"). When recent conversion diverges from lifetime (the common case for any growing or recently-tuned pipeline), the projection is systematically off, eroding trust in the one forward-looking number on the page.
- **Fix sketch**: Compute `overallConversion` from a cohort matched to the velocity horizon (e.g. conversion among entries created in the same trailing-8-week span), or expose a "based on last N weeks" basis label and default the forecast to the windowed view so velocity and conversion share a horizon.

## 4. Calibration reliability diagram has no non-visual data alternative
- **Lens**: 🎨 UI Perfectionist (primary)
- **Severity**: Medium
- **Category**: a11y / chart text alternative
- **Value**: impact 5/10 · effort 3/10 · risk 1/10
- **File**: `app/features/sub_analytics/CalibrationPanel.tsx:25-75`
- **Scenario**: A screen-reader user (or anyone on a print/export) opens the calibration panel. The `<svg role="img">` announces only `aria-label={`${labels.x} / ${labels.y}`}` — i.e. "Predicted probability / Observed advance rate" — with zero bin data. The per-bin predicted-vs-observed values (the entire content of the reliability curve) are conveyed only as dot positions. The Brier number is readable, but the curve that justifies it is inaccessible.
- **Root cause**: The diagram is hand-drawn SVG `<circle>`s with no `<title>`/`<desc>` per point and no parallel table. Unlike the funnel (which has `role="progressbar"` + numeric aria) and the momentum panel (per-week `aria-label`), the calibration bins expose no numbers to assistive tech.
- **Impact**: "How accurate are we?" is a buyer-facing trust artifact (the panel's own comment calls it the moonshot's whole point). Shipping it as a sighted-only chart undercuts both accessibility compliance and the credibility pitch for audit/enterprise buyers who request right-to-explanation evidence.
- **Fix sketch**: Add a visually-hidden `<table>` (or `<desc>` summary) listing each filled bin's `predicted`, `observed`, and `count`, and set the SVG `aria-label` to a one-line summary ("10-bin reliability curve, N samples, Brier X"). Reuse the same data already in `result.bins`.

## 5. Period-over-period comparison is confined to 4 headline stats — channel/source/calibration are un-trendable
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: Medium
- **Category**: Vanity-vs-actionable / benchmarking gap
- **Value**: impact 6/10 · effort 5/10 · risk 2/10
- **File**: `app/_lib/analytics-deltas.ts:22-66` (+ `app/features/sub_analytics/AnalyticsTab.tsx:325-331`)
- **Scenario**: The deltas module ships exactly four comparables (`total`, `hired`, `hireRatePct`, `avgTimeToHireDays`) plus per-stage funnel conversion. A recruiter can see "hire rate +3 pts vs last period" but cannot see whether cost-per-hire is rising, whether a channel's hire rate is degrading, or whether calibration (Brier) is improving — the metrics most tied to spend decisions and to the product's "we get more accurate over time" story carry no baseline at all.
- **Root cause**: `PeriodDeltas` only diffs the scalar cohort metrics; `byChannel`, `bySource`, `byArchetype`, and the calibration result are returned as point-in-time snapshots with no prior-window analogue, and the UI renders them without any trend affordance. The module's own header acknowledges "the comparison IS the insight" but applies it narrowly.
- **Impact**: Analytics that only show current values (not direction) are the textbook vanity-metric trap and a weak retention/upsell hook. Channel ROI trend ("your LinkedIn CPH dropped 18% this quarter") and a rising calibration curve are exactly the recurring "aha" that keeps a buyer logging in and justifies a higher tier.
- **Fix sketch**: Extend `periodDeltas` to diff `byChannel` (by channel key) for `hireRatePct`/`costPerHireCzk` and surface a `DeltaChip` in the Channel Economics rows; add a calibration-over-time series (store periodic Brier snapshots) so the calibration panel can show "improving" rather than a single static curve. Ship channel deltas first — lowest effort, highest spend-decision value.
