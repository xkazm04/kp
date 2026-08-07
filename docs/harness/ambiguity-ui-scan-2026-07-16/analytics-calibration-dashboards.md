# Analytics & Calibration Dashboards — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 2 high, 3 medium, 0 low)

## 1. Time-to-hire is a mean but the leadership readout labels it "median"

- **Severity**: High
- **Lens**: ambiguity
- **Category**: mislabeled-statistic
- **File**: `app/features/sub_analytics/AnalyticsTab.tsx:585`
- **Scenario**: A TA lead reads the ROI ledger's "Time to hire" tile, whose sub-label is `t("rdMedian")` → the literal string "median" (`messages/en.json:3756`). The value shown is `data.avgTimeToHireDays`, which `pipelineAnalytics` computes as an arithmetic **mean** (`app/_lib/db/analytics.ts:230`: `tth.reduce((a,b)=>a+b,0)/tth.length`), not a median.
- **Root cause**: The field is named `avgTimeToHireDays` and derived as an average, but the display sub-label was copied without matching the statistic. (The `OrgBenchmarkPanel` on the same page uses a genuinely-median `medianTimeToHireDays` from a different query, so the page mislabels one and correctly labels the other — easy to conflate.)
- **Impact**: In a codebase whose entire design ethos is honest labeling of every figure, this is a defensible-upward number stated as the wrong statistic. Mean and median time-to-hire diverge sharply under a few slow outliers, so a leader defending "median 24 days" is actually quoting a right-skewed mean — a wrong claim in a report meant to be audit-grade.
- **Fix sketch**: Either change the sub-label key to say "average/mean", or compute an actual median in `pipelineAnalytics` and rename the field. Cheapest correct fix: point `rdMedian` at an "average" string (and the CSV `rdTimeToHire` row) since the value is a mean. Do not silently swap to median without changing the computation.

## 2. Prior-window `bySource` is not upper-bounded, so period-over-period source deltas are wrong

- **Severity**: High
- **Lens**: ambiguity
- **Category**: incorrect-windowing
- **File**: `app/_lib/db/analytics.ts:670` (also the main battery at `:398`)
- **Scenario**: On a 30/90-day view the SourcePanel shows a per-source volume chip ("vs the prior equal-length window"). The prior window is built by `pipelineAnalyticsPrior(N, endMs = now − N·day)`. Its cohort `rows` are correctly bounded `created_at >= cutoff AND < upper`, but the `bySource` first-event JOIN filters `p.created_at >= cutoffIso` with **no upper bound**, so the "prior" source counts include every entry from the prior window start straight through *now* — i.e. the prior counts absorb the entire current window.
- **Root cause**: The prior slice was pinned "byte-identical" to the full battery, whose `sourceRows` query is *also* only lower-bounded (`:398`). The cohort SELECT was bounded but the origin JOIN was never given the matching `AND p.created_at < upperIso`. The byte-identity test (`analytics-prior-slice.test.ts`) passes because both code paths share the same defect.
- **Impact**: Prior source volume is inflated by ~the current window's inflow, so `current − prior` reads strongly negative for nearly every source — "source effectiveness over time" reports declines even for stable or growing channels. Directly the "wrong signal drives a decision" risk (a recruiter pauses a healthy channel). `byChannel` is unaffected (it reads the bounded `rows`); only the JOIN-derived `bySource` is wrong.
- **Fix sketch**: Add `AND p.created_at < ?` (upperIso) to the prior slice's `sourceRows` subquery/outer WHERE, binding `upperIso`. Apply the same bound to the main battery's `sourceRows` when `opts.endMs` is set (prior calls), and update `analytics-prior-slice.test.ts` to assert against the corrected, bounded expectation rather than pinning the current behavior.

## 3. Client discards the server's staleness (409) message and fresh recommendation

- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: error-handling
- **File**: `app/features/sub_analytics/CalibrationPanel.tsx:347`
- **Scenario**: Two people have the calibration panel open, or the data moves between panel load and click. When one applies the screening-floor suggestion, `apply-threshold` returns **409** with a purpose-built body: `{ error: "The recommendation changed since it was shown — reload and review the current suggestion.", recommendation: rec }` (`apply-threshold/route.ts:54,58-62`). The client does `if (!r.ok) throw new Error()` and renders the generic `t("recError")`.
- **Root cause**: `apply()` treats every non-2xx identically and never reads the response body, so the two distinct 409 staleness cases (no-rec-anymore / suggestion-changed) are collapsed into the same opaque error as a 500 — and the fresh `recommendation` the server hands back is thrown away.
- **Impact**: The user is told "couldn't apply" with no reason; clicking Apply again re-sends the same now-stale `suggestedThreshold`, 409s again, and dead-loops. A carefully designed reversible-write guard produces an un-actionable dead end at the UI.
- **Fix sketch**: In the `catch`/response handling, branch on `r.status === 409`: surface the server's `error` string and offer a "reload" action (call `onApplied()`/`reload()` so the freshly-returned `recommendation` re-renders). Keep the generic message only for 500s.

## 4. OrgBenchmarkPanel heading + number styling breaks the page's panel rhythm

- **Severity**: Medium
- **Lens**: ui
- **Category**: typography-inconsistency
- **File**: `app/features/sub_analytics/OrgBenchmarkPanel.tsx:94`
- **Scenario**: Every sibling panel on the Analytics tab titles itself with `<h3 className="font-serif text-h2 text-ink">` (CalibrationPanel, DecisionRecordsPanel, MomentumPanel, ChannelEconomicsPanel, "By role"). OrgBenchmarkPanel instead uses `<h3 className="text-sm font-semibold uppercase tracking-wide text-steel">` and renders its metrics with `text-2xl font-bold tabular-nums` / `text-micro` (`:43-44`) — type ramp values that appear nowhere else on the page.
- **Root cause**: The panel was built against a different (uppercase-eyebrow) heading convention than the serif-display one the rest of the tab standardized on, and uses raw `text-2xl`/`text-micro` rather than the page's `text-h2`/`text-meta` tokens.
- **Impact**: Scanning the tab vertically, this panel's header reads as a lower-tier subsection than its neighbors even though it's a peer full-width panel, and its stat numerals don't match the `font-serif` figures used in the Stat cluster / ROI readout — a visible hierarchy and typographic break in an otherwise consistent column of panels.
- **Fix sketch**: Adopt the sibling pattern: `<h3 className="font-serif text-h2 text-ink">` for the title (keep the `Building2` icon), and move the metric numerals to the page's serif display/`text-h3` token set with `text-meta` for the org sub-line. No data change — purely align to the existing panel recipe.

## 5. In-panel error messages render in muted grey, not as errors

- **Severity**: Medium
- **Lens**: ui
- **Category**: error-state-visual
- **File**: `app/features/sub_analytics/CalibrationPanel.tsx:650` (same at `DecisionRecordsPanel.tsx:93`, `OrgBenchmarkPanel.tsx:68`)
- **Scenario**: When a sub-panel's fetch fails, the message is announced `role="alert"` but painted `text-stone-500` / `text-steel` — the same muted grey used for secondary hints and loading text. The page's top-level error (`AnalyticsTab.tsx:103`) is `text-coral`, so on the same screen an error looks like an error at the top and looks like a caption in the panels.
- **Root cause**: The recovery affordance (retry button) was added for a prior scan, but the message text color was left at the default muted token rather than the error/coral token the tab uses elsewhere.
- **Impact**: A sighted user skimming past a failed panel reads the grey line as an ordinary note and misses that the data failed to load and is retryable — the visual weight contradicts the assertive `role="alert"`. Inconsistent error emphasis across one page.
- **Fix sketch**: Color the error message text `text-coral` (matching the top-level error and the DecisionLog's `phase === "error"` box), keeping the retry button as-is. Optionally wrap in the same coral-bordered container the DecisionLog uses for a consistent error affordance across the tab.
