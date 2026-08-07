> Total: 5 findings (0c critical, 1h high, 2m medium, 2l low)

## 1. Four hand-written copies of the "group rows → tally interview/hired → hireRatePct" loop in db/analytics.ts
- **Severity**: High
- **Category**: duplication
- **File**: app/_lib/db/analytics.ts:218-258 (byJob), 359-376 (bySource), 381-434 (byChannel), 439-461 (byVariant); also 271-278 (byArchetype, partial)
- **Scenario**: `grep -n 'if (idxOf(r.stage) >= idxOf("Interview"))|if (r.stage === "Hired")'` returns the identical two-line tally at 223/224, 364/365, 386/387, 456/457, and `grep -n 'Math.round((m.hired / m.total) * 100)'` returns the same `hireRatePct` expression at 254, 374, 420, plus the byArchetype `advanceRatePct` variant at 276. Each of the four `Map<string,{total,reachedInterview,hired}>` accumulators is built with a near-identical `m.total += 1; if (reached Interview) m.reachedInterview += 1; if (Hired) m.hired += 1` loop, then mapped with the same `hireRatePct: m.total ? Math.round((m.hired/m.total)*100) : 0` shaping.
- **Root cause**: The funnel-tally + percent-shaping logic was copy-pasted each time a new grouping dimension (job, source, channel, variant) was added rather than extracted into a shared `tallyByKey(rows, keyFn)` / `hireRatePct(hired,total)` helper.
- **Impact**: A change to what "reached Interview" means, or to the rounding/empty-cohort convention, must be made in 4-5 places and is easy to miss in one — the channel and variant tables could silently disagree with byJob. Inflates the 631-line module and obscures the genuinely-different per-group logic (byChannel also tracks `rejected`; byVariant tracks `firstLeadAt`).
- **Fix sketch**: Extract a small `accumulateGroups(rows, keyFn, extra?)` that returns `{total, reachedInterview, hired}` per key, and a `hireRatePct(hired, total)` returning `total ? Math.round((hired/total)*100) : 0`. byChannel/byVariant pass an `extra` reducer for their additional fields. Keep byArchetype's `advanceRatePct` (different numerator — `hasAdvancedPastScreening`) as its own call. Verify the `: 0` empty-cohort convention is preserved (it differs from analytics-deltas' `hireRate`, which returns null — do NOT unify those two; see finding 4).

## 2. searchEntities / SearchHit / escapeLike (command-palette search) is misplaced inside the analytics DB module
- **Severity**: Medium
- **Category**: structure
- **File**: app/_lib/db/analytics.ts:549-631
- **Scenario**: Lines 549-631 implement "Cross-entity search (SHELL1, the command palette)" — `searchEntities`, `SearchHit`, `escapeLike` — querying profiles/entries/jobs/jds/analyses. `grep -rn 'searchEntities|SearchHit'` shows the only consumers are `app/api/search/route.ts` and `app/features/CommandPalette.tsx`; neither touches analytics. The module's own header comment marks it a distinct section, and the file is re-exported wholesale via `app/_lib/db.ts:17` (`export * from "./db/analytics"`).
- **Root cause**: The command-palette query was parked in the analytics DB file (likely the nearest open file at the time) rather than its own `db/search.ts`.
- **Impact**: A reader looking for analytics aggregation wades through ~83 lines of unrelated entity search; the file is 631 lines partly because of this. Coupling is purely incidental — moving it has no behavioral effect since the barrel re-exports everything anyway.
- **Fix sketch**: Move `searchEntities`/`SearchHit`/`escapeLike` to a new `app/_lib/db/search.ts` and add `export * from "./db/search"` to db.ts. Pure relocation; no call-site changes (consumers import from the `@/app/_lib/db` barrel).

## 3. AnalyticsTab.tsx is a 1161-line file holding ~10 sub-components
- **Severity**: Medium
- **Category**: structure
- **File**: app/features/sub_analytics/AnalyticsTab.tsx:1-1161
- **Scenario**: `wc -l` reports 1161 lines. The single file defines `AnalyticsTab` plus `AutomationPanel`, `RoiLedger`, `ImpactRow`, `SourcePanel`, `ChannelEconomicsPanel`, `InlineNumberSave`, `SpendInput`, `ForecastPanel`, `GoalsEditor`, `TargetInput`, `MomentumPanel`, `Stat`, `DeltaChip` — most of which are self-contained panels with their own `useTranslations` namespace. The directory already splits `CalibrationPanel`, `DecisionLog`, `DecisionRecordsPanel` into siblings, so the pattern for extraction exists.
- **Root cause**: New analytics panels were appended to the orchestrator file instead of getting their own files like the three already extracted.
- **Impact**: Hard to navigate/review; merge-conflict magnet on a multi-author analytics surface; the shared `InlineNumberSave` + its `SpendInput`/`TargetInput`/`DeltaChip`/`Stat` primitives are buried among large panels.
- **Fix sketch**: Extract the larger panels (`ChannelEconomicsPanel`, `AutomationPanel`+`RoiLedger`, `MomentumPanel`, `ForecastPanel`, `GoalsEditor`) into sibling files matching the existing CalibrationPanel/DecisionLog convention; keep `Stat`/`DeltaChip`/`InlineNumberSave` in a small shared `analytics-primitives.tsx`. Mechanical move — no logic change. Not urgent, but high readability payoff.

## 4. bottleneck and stageDwell recompute the same per-stage average over perStageDays
- **Severity**: Low
- **Category**: duplication
- **File**: app/_lib/db/analytics.ts:209-216 (with analytics-bottleneck.ts:28)
- **Scenario**: `perStageDays` is built once (200-205), then `pickBottleneck` (called at 209) computes `days.reduce(...)/days.length` for every stage internally (analytics-bottleneck.ts:28), and `stageDwell` (212-216) immediately re-iterates `FUNNEL_STAGES` computing `Math.round(arr.reduce((a,b)=>a+b,0)/arr.length)` again for each stage. The winning stage's average is thus computed twice from the same array.
- **Root cause**: `pickBottleneck` returns only the single worst stage (`Bottleneck`), so the full per-stage breakdown was added separately rather than having the bottleneck pass emit all stage averages.
- **Impact**: Trivial duplicate arithmetic and a second place the rounding convention lives. Low blast radius (one small loop), but a candidate to fold: a helper returning `{stage, avgDays, count}[]` could feed both the dwell table and `pickBottleneck`'s max-pick.
- **Fix sketch**: Compute `stageDwell` first (avg+count per active stage), then derive `bottleneck` as the max-by-avgDays entry that clears `BOTTLENECK_MIN_SAMPLE` — single source for the per-stage average. Verify rounding: stageDwell rounds avgDays, pickBottleneck rounds `avgDaysInStage` too, so semantics already match.

## 5. Target-key string literals duplicated across the client/server boundary
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/sub_analytics/AnalyticsTab.tsx:934-935 vs app/_lib/db/analytics.ts:89,95
- **Scenario**: AnalyticsTab declares `const TIME_TO_HIRE_KEY = "time_to_hire"` and `const RECRUITER_HOURLY_KEY = "recruiter_hourly_czk"`; db/analytics.ts exports `TIME_TO_HIRE_TARGET_KEY = "time_to_hire"` and `RECRUITER_HOURLY_TARGET_KEY = "recruiter_hourly_czk"` with byte-identical values. `grep -rn` confirms the same two strings live in both. The client comment (931-933) explains the redeclaration is to avoid importing the better-sqlite3 db barrel for two strings.
- **Root cause**: No shared, server-import-free constants module; the client can't safely import the db barrel, so it re-typed the literals.
- **Impact**: If the reserved key strings ever change, the client and server can silently drift — the goal editor would POST a metric the server's `VALID_METRICS` set rejects, and the failure is a generic save-failed. Deliberate and commented, but still a drift surface.
- **Fix sketch**: Move the two key strings into a tiny pure module (e.g. `app/_lib/analytics-target-keys.ts`, no `@/` server imports) and import it from both AnalyticsTab and db/analytics.ts (the targets route already imports from db, so it can re-export). Keeps the strings single-sourced without dragging better-sqlite3 into the client bundle.
