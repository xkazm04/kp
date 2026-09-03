# About — the six-mechanism explainer deck

The Insights → About tab. Six chapters, each a self-playing diagram of a
mechanism the product really runs, with the product's own identifiers printed on
the parts.

It replaced a 24-item capability browser that rendered a PlantUML diagram and a
paragraph per item. That surface answered *what is in here*, which the nav
already answers. This one answers the question a reader actually arrives with:
*why should I believe any of this works.*

**The property that makes the tab worth having is that it is TRUE.** An
explainer that teaches a rule the product does not implement is worse than no
explainer — the reader reasons confidently from it and every downstream decision
inherits the misunderstanding. So every number and stage name in the copy is
quoted from a constant in `pipeline/jobfit/` or `app/_lib/`, and the couplings a
machine can check are checked by `app/features/insights/about/chapters.test.ts`.

## Entry points

| Surface | Where |
| --- | --- |
| `?tab=about` | `app/features/insights/about/AboutTab.tsx` |
| Deep link to one chapter | `?tab=about#<id>` — ids in `app/features/insights/about/chapters.ts` (`job-descriptions`, `scoring`, `screening`, `archetypes`, `assignments`, `human-gates`) |
| Out to the architecture diagrams | `/diagrams` (header link) |
| Out to the guided tour | the shell's `SimulationProvider` (header button, hidden while a tour is running) |

The chapter frames — number, eyebrow, title, lede, anchor, handoff link — are
always in the server HTML (`stage/Scene.tsx`). Only the art is code-split, one
`next/dynamic` chunk per chapter, so the rail, the deep links and the whole
argument survive with JavaScript still in flight.

## The six chapters, and what each one is pinned to

| # | Chapter | Claims quoted from | Guarded by |
| --- | --- | --- | --- |
| 1 | Job descriptions — nothing invented | the grounding rule ("every mustHave must trace to something the inputs state") | prose; the orphan row is the argument |
| 2 | Candidate scoring — three answers, not two | `_MATCH_THRESHOLD = 0.5` (`pipeline/jobfit/matching.py`), `_SIBLING_MATCH = 0.4` (`pipeline/jobfit/taxonomy.py`) | `chapters.test.ts` — both constants, their ordering, the en copy that prints them, and the painted line's derived position |
| 3 | Screening — cheap filters first | `ko_filter` / `score_job` (`pipeline/jobfit/matching.py`), `match_reasoning` (its own module), `KoReasonKey` | `chapters.test.ts` — the layer names exist and every gate reason shown is a real `KoReasonKey` |
| 4 | Archetypes — the same three slots, weighted differently | `pipeline/jobfit/archetypes.json` (rule weights, `selfDeclaredConfidence`, `defaultArchetype`, `defaultConfidence`, `lowConfidenceThreshold`) | `chapters.test.ts` — the tally board is parsed back out and compared to the registry |
| 5 | Assignments — a work sample that survives delegation | the `sim >= 0.85` prompt gate (`pipeline/jobfit/devcase/artifact_checks.py`), `dev_cases.baseline_json` | `chapters.test.ts` — the gate, the scene's `AIM`, and that the worked example sits below it |
| 6 | Human gates — the machine ranks, a person decides | the approval path in `app/_lib/automation-pass.ts` | prose |

**One deliberate exception.** Chapter 3's `120 / 74 / 8` are *not* quoted from
anything: the shortlist width is whatever the caller asks `match_reasoning` for
and the survival rate is whatever the gates say about real applicants. They are
a worked example of the shape, and the scene says so —
`about.screening.figuresNote`, asserted by the same test. If one of them ever
becomes a real default, guard it and delete the note.

## How a scene is built

A scene is a **deterministic integer clock** driving **pure phase functions**.
The clock is the only stateful thing in it; everything below renders whatever
the phase says. That split is why a scene's choreography can be reviewed as a
table of beats instead of chased through JSX, and why the loops are unit-tested
without a DOM.

| Module | Role |
| --- | --- |
| `stage/useSceneClock.ts` | the hook: viewport, motion preference and page visibility → a phase |
| `stage/clock.ts` | pure — `shouldTick`, `phaseOf`, `isVisibleState` (`clock.test.ts`) |
| `stage/stages.ts` | pure — the cumulative `ghost → shell → body → detail → chosen` ladder, percent rects, the sub-beat cascade (`stages.test.ts`) |
| `stage/threads.ts` | pure — connector anchors and curves, derived from the same rects the boxes are drawn from, with a bounded path memo (`threads.test.ts`) |
| `stage/parts.tsx` | the dumb parts: `Field`, `Slot`, `Part`, `Wire`, `Wires` |
| `stage/Scene.tsx` | chapter chrome: number, eyebrow, title, lede, handoff link |
| `scenes/status.ts` | pure — the status line's phase → text lookup (`status.test.ts`) |
| `scenes/shared.tsx` | `SceneStatus`, `LaneLabel`, `CodeLabel`, `Bar` |

**Clock contract.** Off screen the interval is torn down. Re-entering rewinds to
beat 0, so nobody joins a sentence half-typed. Reduced motion pins `stillTick` —
the first beat at which every module has reached its final stage — and never
creates a timer. A **backgrounded tab pauses and keeps its tick**: `useInView`
measures geometry, which a hidden tab retains, so without the
`visibilitychange` term every scrolled-to scene kept re-rendering its diagram
every 900ms in a tab nobody was looking at. Pause, not rewind — returning to a
tab is not the same gesture as scrolling a scene back into view.

## Navigation

`ChapterRail.tsx` exports two shapes over one reading position (`useActiveChapter`,
an `IntersectionObserver` with a `-45%/-45%` band so tall neighbouring scenes do
not make the marker flicker):

- **`ChapterRail`** — the sticky gutter rail, `xl` and up, printing chapter
  titles. Last in the DOM on purpose: a table of contents is navigation, so a
  screen reader and a narrow viewport both meet the chapters first.
- **`ChapterJumpList`** — below `xl`, where there is no gutter and where the deck
  previously had no table of contents at all. A sticky horizontal chip row on
  the `CHIP` recipe (both themes for free), printing chapter *eyebrows* rather
  than titles, and plain anchors — tab, enter and find-on-page work with no
  keydown handler.

Both mark the current chapter with `aria-current="location"` (the token for
"the item in this set that the reader is at"), and each is hidden at the other's
breakpoint with `display`, so only one is in the accessibility tree at a time.

## Localization

Every user-visible string is in `about.*` across all four catalogs. Two things
deliberately are **not** in the catalog and stay in the components:

- **Code identifiers** — `ko_filter()`, `baseline_json`, `_SIBLING_MATCH = 0.4`.
  They arrive through `CodeLabel`'s `code` prop or a named constant, because
  they are function and column names in the running code and putting them in the
  catalog would invite four translators to render `ko_filter()` four ways.
- **Product nouns** — `TypeScript`, `React 19`, `Playwright`, `Kafka` in chapter
  1's requirement rows.

Everything else is prose and belongs in the catalog, including prose that *looks*
like data: chapter 1's "Postgres or SQLite", "Owning a service end to end" and
"Czech + English" shipped from a component array and reached Czech readers in
English until they moved to `about.jd.reqs.*`.

## Data model

None. The tab makes no writes, reads no live data and calls no API. Everything
it shows is authored geometry plus constants read at build time from the engine
sources — which is also why it works identically keyless.

## Known gaps

- Chapters 1 and 6 are pinned by prose review only; their claims are rules, not
  numbers, and there is no constant to compare against.
- `ChapterRail` and `ChapterJumpList` each run their own `IntersectionObserver`
  over the same six sections (both are mounted at every width, hidden by CSS).
  Cheap, but it is two observers doing one job.
- `docs/features/matching/README.md` carries a `doc-map` block naming
  `app/features/insights/about/scenes/archetypes/**`, which is not in
  `scripts/docs/feature-doc-map.json`; chapter 4 is watched through this doc's
  entry instead.
