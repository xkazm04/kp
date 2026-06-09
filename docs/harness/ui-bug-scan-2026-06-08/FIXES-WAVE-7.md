# UI+Bug Scan — Fix Wave 7: Score / number / label consistency

> 8 findings closed (1 High, 5 Medium, 2 Low) across 7 atomic commits.
> Baseline preserved: tsc 0 → 0, next build ✓, unit 638 → 638, lint clean.
> One mental model: **single source of truth for every derived number, tone, and unit.**

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `1ae4c71` | ScoreDial readout color ≠ scoreTone | High | ScoreDial.tsx |
| 2 | `f423f47` | History score ≠ report dial score | Medium | analyze-run.ts |
| 3 | `41bcf0e` | currency "CZK" literal + untrimmed coerce | Medium ×2 | salary-band.ts |
| 4 | `476b026` | JD template "/ mo" vs "/ month" | Medium | JdBuilder.tsx |
| 5 | `a305648` | completeness meter 2-tier vs 3-tier scoreTone | Medium | ProfileResultPanel.tsx |
| 6 | `1d2a198` | SalaryGauge marker/aria ≠ card target | Low | SalaryGauge.tsx, SalaryTab.tsx |
| 7 | `874d9e8` | even-count median rounds up across strong line | Low | matrix-stats.ts |

## What was fixed

1. **ScoreDial readout (High)** — colored the prominent number/label from the dial's own 40/70 bands, disagreeing with scoreTone's 50/75 (a 45 read amber on the dial, coral on the badge). Readout now uses `scoreToneColor(scoreTone())`; the arc keeps its five aesthetic bands.
2. **History ↔ dial score (Med)** — the denormalized `analyses.score` stored the raw pipeline total while the dial renders `reconcileScoreTotal` (component sum). `persistAnalysis` now stores the reconciled total (raw stays in payload), so the list/header match the dial.
3. **currency + trim (Med ×2)** — `normalizeMarketSalary` fell back to a hardcoded "CZK" (not `APP_CURRENCY`) and `coerceString` returned the untrimmed value. Now falls back to `APP_CURRENCY` and trims.
4. **JD salary unit (Med)** — the template path printed "/ mo" while every other path prints "/ month". Aligned to "month".
5. **completeness meter (Med)** — used an ad-hoc 2-tier `pct >= 70`, so 55-69% read alarming "weak" red vs amber "mid" elsewhere. Routed through `scoreTone(pct)`.
6. **SalaryGauge target (Low)** — the dashed "+30%" marker + aria used an unrounded `midpoint*1.3` while the card showed it rounded — three figures for one target. Computed once and passed in.
7. **median band (Low)** — an even-count median `Math.round` could round a band-straddling pair (71/72 → 72) up across `STRONG_THRESHOLD`. Floored instead.

## Verification (before / after)

| Gate | Baseline (B2) | After Wave 7 |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| next build | ✓ | ✓ (Compiled successfully) |
| test:unit | 638 pass | 638 pass |
| eslint (touched files) | — | clean |

No regressions; the matrix-stats and salary-band unit tests still pass (the median test uses an exact-integer midpoint, unaffected by floor).

## Cumulative status (waves 1–7)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Trust-boundary & validation (security) | 8 |
| 2 | Data integrity | 7 |
| 3 | Identity-by-label / wrong-record | 5 |
| 4 | Concurrency & idempotency | 6 |
| 5 | Stale UI / fetch-state | 8 |
| 6 | Silent failures & opaque errors | 6 |
| 7 | Score / number / label consistency | 8 |
| | **Total** | **48** |

**35 findings remain across 2 themes + 1 deferred** (W8 accessibility ~12 + W9 UI states/polish ~13 + the deferred sim-reset Med). All Medium/Low.

## Patterns established (catalogue item 20)

20. **Derived value computed in two places drifts.** When a number, tone, unit, or label is re-derived at more than one render site (dial vs badge thresholds; raw vs reconciled total; rounded vs unrounded target; "mo" vs "month"; 2-tier vs 3-tier tone), the copies disagree on the same underlying figure. Compute it once at a single source (a shared helper like `scoreTone`/`reconcileScoreTotal`, or a value passed down as a prop) and consume that everywhere.

## What remains

35 findings (W8 accessibility, W9 UI states/polish, + 1 deferred Med). Recommended next: **Wave 8 — Accessibility pass** (Modal focus-trap/reduced-motion, matrix table semantics, aria-live on streamed/async surfaces, unlabeled controls, focus management) — ~12 fixes; the shared Modal/primitive fixes multiply across the whole app.
