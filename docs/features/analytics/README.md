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

`?sec=` is an **inbox, not state**: the active section lives in React state and
the param is read only on arrival, then cleared
(`shell/nav/useUrlInboxState.ts`). A link to "Analytics → Quality & audit" still
lands, but clicking between sections writes nothing to the URL. `?win=` is
different and stays a real URL param — it is a *view preference* that should
survive a round-trip to the board and back, and it changes the fetch.

**Each section is its own chunk** (`next/dynamic` in `AnalyticsTab.tsx`), with a
second level of per-panel chunks inside (`sections/sectionChunks.tsx`). A reader
in Economics never downloads the reliability diagram, the sealed-floor strip or
the paged decision log.

### Economics is one comparison board

The Economics round closed on **Board** (`sections/EconomicsBoard.tsx`): the page
carried three acquisition tables with three different taxonomies — first-touch
`bySource`, stored `byChannel`, and per-creative variants — and left the reader to
normalise the columns. The board puts every surface in one sortable table with the
same unit-economics columns.

The taxonomies are **grouped and labelled, never merged**: the type chip is part
of each row's identity, because those three are genuinely different measurements.
A dash under Spend means "not measured for this kind of surface", not "free", and
the table says so under the rule.

### Performance reads as a brief

The prototype round closed on the **Briefing** direction
(`sections/PerformanceBriefing.tsx`), so the variant switcher and the three
losing designs are gone. What distinguishes it from the panel grid it replaced:
each band opens with a **claim computed from the data** ("Candidates are stalling
at Offer, 75 days on average") and the chart underneath is the evidence for that
claim, rather than the point of the band. Where the data can't support a claim,
the band says so instead of rendering an inconclusive chart.

Band headings deliberately carry **no max-width** — the measure that keeps body
copy readable was breaking one-sentence headings onto a second row with most of
the row empty, and a two-line heading reads as two ideas. `text-balance` handles
the rare genuinely-long claim.

The **scoreboard** direction was not wasted: its per-role overview moved to the
JD library, which is where a recruiter is already looking at their roles. See
`docs/features/jobs/README.md` and `app/_components/ui/PipelineShapeBar.tsx`.

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

- **`byJob` is volume-capped server-side.** The by-role table shows only the
  highest-volume roles (`byJobTotal` vs `byJob.length`, stated in the header).
  Any future design that RANKS roles here — rather than merely listing them —
  needs the cap lifted or the ranking done server-side, or it can hide its own
  leader: a small role with a great hire rate that missed the volume cut.
- **The decision log throws a `FORMATTING_ERROR` on some rows.**
  `waveReasonText` (`app/_lib/decision-attribution.ts`) formats a message with
  `{pct}`/`{n}`/`{rank}` placeholders that some wave reasons don't supply, and
  `analyticsDecisionLogTypes.ts` warns on the unmapped decision kind
  `human_round_queued`. Pre-existing, visible in the Quality section.
- Per-tenant `llm_usage` attribution is not built, so compute cost is
  account-wide (see `docs/architecture/llm-provider-layer.md`).
