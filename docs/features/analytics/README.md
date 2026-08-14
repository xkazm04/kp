# Analytics

Hiring measurement for the workspace: funnel health, forward projection, channel
and compute economics, and the auditable record of what the automation decided.

Rendered by `app/features/insights/analytics/AnalyticsTab.tsx` at
`/?tab=analytics`.

## Three sections, not one scroll

The tab is split into three sections behind a switcher
(`sections/AnalyticsSectionNav.tsx`), because it had grown into a ~10-panel
scroll answering three unrelated questions at once — and every visit paid for all
three, including the reader who came for the funnel.

| Section (`?sec=`) | Question | Panels |
| --- | --- | --- |
| `performance` (default) | How is hiring going? | funnel, forecast, momentum, by-role, archetype, company benchmark |
| `economics` | What does it cost, and what earns it back? | automation ROI, source, channel economics, compute cost |
| `quality` | Can I trust the scoring, and prove what we decided? | calibration, decision records, decision log |

The section vocabulary is one literal array with a derived union and a runtime
guard (`sections/analyticsSections.ts`) — the same shape as
`app/features/shell/tabs.ts`, so an unknown `?sec=` resolves to the default
instead of rendering nothing. Covered by `sections/analyticsSections.test.ts` and
`e2e/analytics-sections.spec.ts`.

`?sec=` rides the URL for the same reason `?win=` does: a link to
"Analytics → Quality & audit" is a thing people send each other, and an auditor
who reloads should land back where they were. Both are written with
`router.replace` (no history spam) and neither is tab-scoped.

**Each section is its own chunk** (`next/dynamic` in `AnalyticsTab.tsx`), with a
second level of per-panel chunks inside (`sections/sectionChunks.tsx`). A reader
in Economics never downloads the reliability diagram, the sealed-floor strip or
the paged decision log.

### Performance is mid-prototype

The Performance section currently hosts a **throwaway variant switcher**
(`sections/PerformanceSection.tsx`) with `PerformanceBaseline` as the default and
three directional designs beside it — `PerformanceFlightDeck` (cockpit),
`PerformanceBriefing` (editorial claims + evidence), `PerformanceScoreboard`
(role league table). When a direction is chosen, the switcher and the losing
files are deleted and the winner renders directly. Nothing else depends on the
switcher; every variant takes the same `PerformanceProps`.

## API surface

| Route | Serves |
| --- | --- |
| `GET /api/analytics` | The main payload (`AnalyticsTypes.ts` → `Analytics`); `?days=30\|90` scopes the cohort window, absent = all time |
| `GET /api/analytics/decisions` | The paged decision log (`useInfiniteScroll`, 20/page) |
| `GET /api/analytics/calibration` | Score-band calibration + reliability |
| `POST /api/analytics/calibration/apply-threshold` | Commit a suggested threshold |
| `GET /api/analytics/calibration/band` · `/threshold-history` | Band detail and the sealed floor-over-time strip |
| `GET /api/analytics/spend` | Per-channel spend, written back by the inline spend input |
| `GET|POST /api/analytics/targets` | Recruiter-set conversion / time-to-hire goals |
| `GET /api/analytics/metric-pack?format=md` | The four buyer metrics as a downloadable Markdown pack |

Pure computation lives beside the route, not in it: `analytics-forecast.ts`
(projection), `analytics-momentum.ts` (weekly series), `analytics-deltas.ts`
(vs-previous-period), `analytics-bottleneck.ts`, `analytics-offer.ts`,
`analytics-cache.ts` — each with a colocated `.test.ts`.

## The shared table kit

Analytics tables use the app-wide primitives in `app/_components/table/` rather
than re-deriving them:

| Primitive | Owns |
| --- | --- |
| `TablePager` | Which slice am I looking at (20/page, client-side) |
| `ColumnFilter` | Which rows qualify (header-as-trigger; use `trigger="icon"` beside a sort control) |
| `ColumnHead` + `useTableSort` | The ordering |

`ColumnHead` renders the `<th>` itself so `aria-sort` cannot be omitted — both
hand-rolled sort headers that predated it left the sort state invisible to
assistive tech. `useTableSort` pins one rule the hand-rolled comparators kept
getting wrong: **a missing value is not a small value**. Nulls sort last in both
directions, so "highest cost first" doesn't bury real spend under unpriced calls
(`useTableSort.test.ts`).

## Honesty rules this surface keeps

These are load-bearing, not stylistic:

- An unknown cost renders as `—`, never `$0` — "free" and "unpriced" are
  different facts.
- The forecast refuses to project below its signal floor instead of printing a
  misleading zero (`forecastHires().hasSignal`).
- The by-role table is capped to the highest-volume roles and says so
  (`byJobTotal` vs `byJob.length`).
- The first-run empty state previews the metrics with literal em-dashes and never
  fabricates sample figures (`AnalyticsEmptyPreview`).

## Known gaps

- **`byJob` is volume-capped server-side.** A league-table design that ranks by
  hire rate over that capped set can hide its own leader; committing to the
  Scoreboard variant means ranking server-side or returning every role.
- **The decision log throws a `FORMATTING_ERROR` on some rows.**
  `waveReasonText` (`app/_lib/decision-attribution.ts`) formats a message with
  `{pct}`/`{n}`/`{rank}` placeholders that some wave reasons don't supply, and
  `analyticsDecisionLogTypes.ts` warns on the unmapped decision kind
  `human_round_queued`. Pre-existing, visible in the Quality section.
- Per-tenant `llm_usage` attribution is not built, so compute cost is
  account-wide (see `docs/architecture/llm-provider-layer.md`).
