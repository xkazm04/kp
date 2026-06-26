# Analytics & Calibration Dashboards — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C1/H2/M2/L0

## 1. Workspace boundary applied inconsistently across the SAME dashboard
- **Lens**: 🌀 Ambiguity
- **Severity**: Critical
- **Category**: multi-tenant correctness / undocumented invariant
- **File**: app/_lib/db/analytics.ts:131
- **Observation**: The calibration route deliberately scopes its dataset to the request's tenant — `calibrationPairs(await currentWorkspace())` (app/api/analytics/calibration/route.ts:18), and `calibrationPairs` filters `WHERE ... workspace_id = ?` (app/_lib/db/analyses.ts:114). But the sibling `/api/analytics` route calls `pipelineAnalytics(windowDays)` with no tenant (app/api/analytics/route.ts:32), and every query inside `pipelineAnalytics` reads `FROM pipeline_entries` / `FROM pipeline_events` with **no `workspace_id` predicate at all** (app/_lib/db/analytics.ts:131-138, 234-236, 287-292, 302-356). The decision log (`listPipelineEvents`/`countPipelineEvents`, app/_lib/db/pipeline.ts:67,181) and channel spend are likewise unscoped. Yet `pipeline_entries.workspace_id` exists, is indexed (`idx_pipeline_workspace`, core.ts:672), and pipeline.ts:602-606 explicitly documents the invariant ("the board it links to / writes onto must be too"). So on one dashboard, the Calibration panel describes a single workspace while the funnel, momentum, decision log, cost-per-hire and by-role tables beside it describe **every workspace blended together**.
- **Why it matters**: For any deployment with ≥2 workspaces this is a silent cross-tenant data leak AND internally contradictory analytics — the funnel a recruiter "sees" isn't their company's, and it doesn't even match the calibration curve rendered next to it. These are exactly the "silent wrong hiring outcomes" the audit flags as Critical, and no comment records the assumption that analytics is single-tenant.
- **Recommendation**: Thread `currentWorkspace()` from `/api/analytics`, `/decisions`, `/spend` into `pipelineAnalytics`, `listPipelineEvents`, `countPipelineEvents`, `listChannelSpend` and add `AND workspace_id = ?` to each aggregate (the index already exists). If single-tenant is genuinely intended, document that decision and remove the lone scoping on calibration so the panels agree.
- **Effort**: M

## 2. Per-role-family calibration is built and shippable but never surfaced (dark capability)
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / competitive differentiation
- **File**: app/features/sub_analytics/CalibrationPanel.tsx:86
- **Observation**: The calibration API already accepts `?roleFamily` and filters the pairs to one family so "a buyer can ask 'how accurate are you for backend roles?'" (app/api/analytics/calibration/route.ts:17-21), and every `CalibrationPair` carries `roleFamily` (app/_lib/db/analyses.ts:106,124). But `CalibrationPanel` fetches the bare endpoint `useJsonFetch<CalibrationResult>("/api/analytics/calibration")` with no params and renders no family selector — so the per-role-family reliability breakdown is computed-capable yet completely unreachable in the UI. kp's known "built-but-unwired" pattern, again.
- **Why it matters**: "We are 0.08 Brier on backend, 0.21 on data-science — here's our error bar per role" is the single most defensible trust/differentiation claim a scoring SaaS can make, and the headline use case the route's own comment names. It's a natural premium-tier gate (calibration depth = paid analytics). Shipping it is a dropdown over an endpoint that already returns the data.
- **Recommendation**: Add a role-family `<select>` to CalibrationPanel that appends `?roleFamily=`; populate options from the distinct families already on analyses. Optionally gate the per-family view behind the analytics tier.
- **Effort**: S

## 3. "Calibration" measures recruiter compliance with the score, not the score's predictive validity
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: hidden confounder / undocumented assumption
- **File**: app/_lib/db/analyses.ts:103
- **Observation**: The outcome label is the recruiter `disposition` collapsed to advance=1/pass=0 (analyses.ts:103-123), and the panel sells this as "a 70 from us advances 70% of the time… converts 'trust our 0-100 score' into" measured reliability (app/_lib/calibration.ts:5-8). The labeling choice (hold/absent excluded) is documented, but the **circularity is not**: the recruiter sees the fit score when they set the disposition, so a high-scoring candidate is advanced partly *because* of the score. The curve therefore largely measures how obediently recruiters follow the score, not whether the score predicts real downstream success (interview-pass / hire / on-the-job performance).
- **Why it matters**: A buyer reading "well-calibrated" will believe the score has validated predictive power, when it may only reflect anchoring. That's a credibility landmine for the exact feature whose entire premise is honesty — and the kind of unrecorded trade-off the Ambiguity lens targets. It also caps the moonshot: the more useful (and harder-to-fake) calibration is score-vs-actual-hire.
- **Recommendation**: Document the confounder in calibration.ts, and add a second outcome definition keyed off a *downstream* event (reached Interview / Hired from pipeline_entries) so the panel can show "score vs advance" and "score vs hire" side by side and label the difference.
- **Effort**: M

## 4. Forecast presents inflow "hires in N weeks" that cannot be hired within N weeks
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic numbers / realization-lag edge case
- **File**: app/_lib/analytics-forecast.ts:69
- **Observation**: Projected hires are `weeklyVelocity × weeks × overallConversion` (analytics-forecast.ts:69-72) over horizons hardcoded to `[4, 8, 12]` weeks (line 40, unexplained) and rendered as "+N hires (4 wks)" (AnalyticsTab.tsx:917-922). But `etaDays` (avg time-to-hire, often ~30 days) is the realization lag (forecast.ts:79) and is shown only as a footnote (AnalyticsTab.tsx:924). A candidate who *arrives* in the next 4 weeks physically cannot be *hired* in those 4 weeks when TTH is 30 days — the figure conflates arrivals with hires. Compounding it: in a 30/90-day windowed view, `overallConversion = hiredReached/firstReached` is censored downward (recent cohorts haven't had time to reach Hired), biasing the forecast pessimistic without any note.
- **Why it matters**: A hiring manager reads "+6 hires in 4 weeks" as a delivery promise; it's actually "+6 candidates entering, hires landing ~one TTH later." Forecasts that quietly mis-time their own output erode trust in the whole analytics surface and can drive premature headcount/spend decisions.
- **Recommendation**: Shift each horizon by `etaDays` (label as "hires landing by week N+lag"), name the magic horizons via a documented const, and add a one-line censoring caveat in windowed views.
- **Effort**: S

## 5. Spend has no time dimension, so windowed cost-per-hire / cost-per-applicant are dead "—"
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: unmet recruiter pain (cost-per-hire trend) / monetization
- **File**: app/_lib/db/analytics.ts:430
- **Observation**: Channel spend is a single lifetime figure per channel (`listChannelSpend` has no period column), so CPA/CPH are honestly suppressed to `null` in any windowed view (analytics.ts:423-431) and the UI renders "—" with an explanatory note (AnalyticsTab.tsx:699, `cpaWindowedNote`). The blended cost-per-hire is likewise all-time only (analytics.ts:472-473). The math is correct, but it means the dashboard can never answer "what did a hire cost us *this quarter*" or show a cost-per-hire/budget-burn trend.
- **Why it matters**: Cost-per-hire-over-time and per-period budget efficiency are core recruiter/leadership questions (the "time-to-fill cost" pain the brief calls out) and a classic premium-analytics lever competitors (Sloneek et al.) charge for. The capability is one schema change away — the per-channel/blended plumbing already exists.
- **Recommendation**: Add a period dimension to channel spend (e.g. `(channel, period_start, amount)`), sum spend within the selected window, and let CPA/CPH compute in windowed views; surface a cost-per-hire trend line alongside momentum.
- **Effort**: M
