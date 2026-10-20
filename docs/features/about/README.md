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
| Out to the architecture diagrams | `/diagrams` (header link, shown only to a caller holding `read` — the explorer is operator-only, see below). A funnel step is addressable as `/diagrams?step=<alias>` (`jd`, `screen`, `decide`, `offer`, `cron`, … — the keys in `app/diagrams/pipelineSteps.ts`); an unknown alias is ignored and the page still renders. |
| Out to the guided tour | the shell's `SimulationProvider` (header button, hidden while a tour is running) |

**The architecture link is gated.** `/diagrams` (`app/diagrams/page.tsx`) draws
this repository's own module paths, the endpoint behind each pipeline step and an
explicit off-spec admission, so it is an engineering artifact rather than product
copy. The page answers `notFound()` unless `isOperator()` — open dev mode is an
operator, a demo-workspace cookie is not — and the header link here is hidden for
a caller whose resolved capability set lacks `read` (the demo seat), fail-open
while the set is still unknown, exactly as the nav rail treats a locked tab. The
step titles and summaries the explorer's drawer renders live in
`messages/*.json` under `diagrams.steps.<id>`; only the status, the cited repo
paths and the PlantUML body stay in `app/diagrams/pipelineSteps.ts`, and
`pipelineSteps.test.ts` holds the two halves in bijection. A docs citation or
chat paste can open a drawer directly with `?step=<alias>`; the explorer writes
the same query on node click (`history.replaceState`) so refresh and share keep
the step. Each `files[]` row in the drawer copies the repo-relative path on
click (parenthetical notes like `(actOnPipelineEntry)` are stripped first).

The chapter frames — number, eyebrow, title, lede, anchor, handoff link — are
always in the server HTML (`stage/Scene.tsx`). Only the art is code-split, one
`next/dynamic` chunk per chapter, so the rail, the deep links and the whole
argument survive with JavaScript still in flight.

## The six chapters, and what each one is pinned to

| # | Chapter | Claims quoted from | Guarded by |
| --- | --- | --- | --- |
| 1 | Job descriptions — nothing invented | the grounding rule ("every mustHave must trace to something the inputs state") | `chapters.test.ts` — `design.py` grounding paragraph plus `about.jd.status.s3` |
| 2 | Candidate scoring — three answers, not two | `_MATCH_THRESHOLD = 0.5` (`pipeline/jobfit/matching.py`), `_SIBLING_MATCH = 0.4` (`pipeline/jobfit/taxonomy.py`) | `chapters.test.ts` — both constants, their ordering, the en copy that prints them, and the painted line's derived position |
| 3 | Screening — cheap filters first | `ko_filter` / `score_job` (`pipeline/jobfit/matching.py`), `match_reasoning` (its own module), `KoReasonKey` | `chapters.test.ts` — the layer names exist and every gate reason shown is a real `KoReasonKey` |
| 4 | Archetypes — the same three slots, weighted differently | `pipeline/jobfit/archetypes.json` (rule weights, `selfDeclaredConfidence`, `defaultArchetype`, `defaultConfidence`, `lowConfidenceThreshold`) | `chapters.test.ts` — the tally board (`TARGETS` / `SIGNALS`, imported from `scenes/archetypes/data.ts`) is compared to the registry |
| 5 | Assignments — a work sample that survives delegation | the `sim >= 0.85` prompt gate (`pipeline/jobfit/devcase/artifact_checks.py`), `dev_cases.baseline_json` | `chapters.test.ts` — the gate, the scene's `AIM`, and that the worked example sits below it |
| 6 | Human gates — the machine ranks, a person decides | `APPROVAL_KINDS` / `needsHumanDecision` (`app/_lib/approval-kinds.ts`), the approval path in `app/_lib/automation-pass.ts` | `chapters.test.ts` — every non-empty `ACTIONS.kind` is `isApprovalKind`, parks iff kind is set, and `needsHumanDecision` still exists |

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
| `stage/useSceneClock.ts` | the hook: viewport, motion preference, page visibility and the chapter's transport store → a phase; exports `SceneTransportContext` |
| `stage/transport.ts` | pure — the reader's transport: `runs`, `readPhase`, `play` / `stop` / `step` / `seek`, `onInViewChange`, the per-chapter and deck stores, and the guarded per-viewer `loadDeckStop` (`transport.test.ts`) |
| `stage/clock.ts` | pure — `shouldTick` (four terms: in view, not reduced, tab visible, not stopped by the reader), `phaseOf`, `isVisibleState` (`clock.test.ts`) |
| `stage/stages.ts` | pure — the cumulative `ghost → shell → body → detail → chosen` ladder, percent rects, the sub-beat cascade (`stages.test.ts`) |
| `stage/threads.ts` | pure — connector anchors and curves, derived from the same rects the boxes are drawn from, with a bounded path memo (`threads.test.ts`) |
| `stage/parts.tsx` | the dumb parts: `Field`, `Slot`, `Part`, `Wire`, `Wires` |
| `stage/Scene.tsx` | chapter chrome: number, eyebrow, title, lede, handoff link |
| `scenes/<chapter>/data.ts` | pure, one per scene — `CYCLE`, `STILL`, `STATUS_BEATS`, `sceneAt(phase)` (every reveal flag and module stage, by name) and the rows `chapters.test.ts` pins. The scene TSX renders from `sceneAt(phase)` and holds no `at(n)` beat literal; its `statusPicker` table `satisfies Record<StatusBeat, string>`, so a sentence on an undeclared beat is a tsc error (`scenes/beats.test.ts`) |
| `scenes/status.ts` | pure — the status line's phase → text lookup (`status.test.ts`) |
| `scenes/shared.tsx` | `SceneStatus`, `LaneLabel`, `CodeLabel`, `Bar`. `SceneStatus`'s outer `p` is a persistent `aria-live="polite"` `aria-atomic` region (`scene-status.test.ts`) so each beat's identifier is announced; the keyed inner span still crossfades for sighted readers. Beside it, OUTSIDE the live region, `SceneTransport` renders step back, stop/play, step forward and a beat scrubber, every label from `about.transport.*`. |

**Clock contract.** Off screen the interval is torn down. Re-entering rewinds to
beat 0, so nobody joins a sentence half-typed. Reduced motion pins `stillTick` —
the first beat at which every module has reached its final stage — and never
creates a timer. `scenes/beats.test.ts` imports each scene's `data.ts` and walks
every phase of its cycle: `sceneAt` is total, every reveal that happens anywhere
in the loop has happened at `STILL`, `STILL - 1` still differs from `STILL` (it
is the *first* complete beat, not a later hold), every status beat lands in
`[0, STILL]`, and the TSX passes `stillTick: STILL` explicitly. Five scenes sat
one beat late until that was executable; `STILL` is now 12 / 10 / 9 / 10 / 9 / 9
for chapters 1-6. A **backgrounded tab pauses and keeps its tick**: `useInView`
measures geometry, which a hidden tab retains, so without the
`visibilitychange` term every scrolled-to scene kept re-rendering its diagram
every 900ms in a tab nobody was looking at. Pause, not rewind — returning to a
tab is not the same gesture as scrolling a scene back into view.

**Transport.** Every loop starts on its own and runs 12.6-13.5 s, so the reader
gets a stop, a step and a scrub (`stage/transport.ts`). The reader's stop is a
fourth term in `shouldTick`, a veto only a labelled Play lifts, and not a local
flag: scrolling away and back rewinds autoplay only, and a held beat survives
any amount of scrolling. Stepping or scrubbing is taking control, so it stops
autoplay; a scrub clamps into `[0, CYCLE)` rather than wrapping. Play continues
from the beat on screen. The header's **Stop all animations** is one-directional
and idempotent: it pins every chapter's `STILL` frame (the one reduced-motion
readers get) unless the reader already chose a beat there, and only **Play
animations** or a chapter's own Play restarts it. The stop-all is remembered per
viewer in `localStorage` (`kp.about.transport.stopped`); every read and write is
guarded, so a private window or blocked storage just renders the deck playing.
OS reduced motion stays the default for those readers: no timer in any state,
no Play button and no stop-all (they would do nothing), but step and scrub stay,
because holding a chosen beat is not motion. The tick lives in a per-chapter
external store that `Chapter` in `AboutTab.tsx` provides, so the chapter frame
still never re-renders per tick.

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
