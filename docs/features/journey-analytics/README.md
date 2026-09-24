# Journey Analytics

One column per candidate journey, time running downward, grouped into role clusters — so a
recruiter can see what the process actually did to everyone at once, rather than reconstructing it
from five screens.

It is a **projection**, not a new ledger. kp already keeps the facts in append-only logs; this
feature reads them together for the first time. The only new write in the whole design is role
intake, which had no history at all.

## Entry points

| Surface | Where |
| --- | --- |
| Nav item | **Insights → Journeys** (`app/features/shell/tabs.ts`, the `insights` group of `NAV_GROUPS`, `chordOverflow: true`) |
| Deep link | `/?tab=journeys` — the usual `?tab=` inbox contract: it lands, it is consumed, a repeat link still works |
| Surface | `app/features/insights/journey/JourneyOverlay.tsx` — a **full-viewport overlay above the workspace**, not a panel in the content frame |
| Board | `app/features/insights/journey/JourneyBoardView.tsx` and the components beside it |

### Why an overlay rather than a tab panel

Every other tab renders inside Workspace's `max-w-[108rem]` container. This board puts dozens of
columns side by side with a canonical step rail down the left and needs the whole window, height
included. It reuses the shape `app/features/hiring/pipeline/map/orchard/OverlayShell.tsx`
established — scrim at `z-40`, dialog surface at `z-50`, `useDialogA11y` for the focus trap, scroll
lock and Escape. `journeys` is still a real tab id, so deep links, the chord system and the nav
highlight all work; closing the overlay returns the reader to the tab they came from, which
`Workspace.tsx` remembers.

## User flow

1. Open **Insights → Journeys**. The board loads the workspace's roles as clusters.
2. Each cluster shows the **shared job-definition band** once, above all its columns — the
   conversation that defined the role happened once, before anyone was a candidate. The band says so,
   and says when the intake record is not actually linked to that role.
3. Below it, one column per candidate, aligned to the **canonical step rail**: row *n* means the
   same step in every column of that cluster, so a gap is visible in place rather than inferred.
   There is **one rail for the whole board**, pinned at the far left; it re-renders for whichever
   cluster is under view and names that role (`journey.rail.forRole`). Steps are per role — equal
   vertical position in two clusters is NOT the same step — so a rail that did not say which role it
   describes would be a lie. Completion reads as a number (`38 of 45`), not a bar.
4. Filter by role, to active candidates only, or search for a person.
5. Click any row for a **fact card** (actor, both clocks, phase, what changed, topic). "Open the
   source" is a deliberate **second** step that reveals the underlying excerpt. The board never
   renders a raw transcript inline.

## API / lib surface

| Symbol | File | What |
| --- | --- | --- |
| `GET /api/journeys` | `app/api/journeys/route.ts` | The board. `?role=` (a `job_id`), `?active=1`, `?limit=`/`?offset=` paged **by column** (default 20, max 50). Tenancy via `currentWorkspace()`; no `requireOperator()`, matching `/api/analytics`. Per-IP rate limit 120/10min |
| `GET /api/journeys/[entryId]` | `app/api/journeys/[entryId]/route.ts` | One column; with `?event=` one `JourneyEventDetail` |
| `journeyBoard` / `journeyColumn` / `journeyEventDetail` | `app/_lib/journey/project.ts` | The projection |
| `journeyRail` / `railCellState` | `app/_lib/journey/project.ts` | The canonical rail and its cell states |
| `clusterIndexInView` | `app/features/insights/journey/journeyLayout.ts` | Which cluster the single rail currently describes, from the scroller's offset |
| `rolePickerOptions` | `app/features/insights/journey/journeyFilters.ts` | The role dropdown, grouped by `roleArea` and sorted by title |
| `journeyAnalysisAttachment` | `app/_lib/journey/identity.ts` | The analysis join rule — `none` / `confirmed` / `label-only` |
| `journeyEventMessageKey` | `app/_lib/journey/render-keys.ts` | kind (or topic) → catalog key |
| types | `app/_lib/journey/types.ts` | The wire contract |
| `recordIntakeEvent` / `listIntakeEvents` | `app/_lib/db/intake-events.ts` | The intake history chokepoint |
| `classifyIntakeRound` | `app/_lib/journey/intake-topics.ts` | Topic classification with a deterministic keyless fallback |

## Data model

Projected from, all workspace-scoped:

| Source | Phase | Notes |
| --- | --- | --- |
| `pipeline_events` | screening | append-only; has **no `job_id`** — the job axis comes from `pipeline_entries` |
| `analyses` | screening | joined by (label + `jd_slug`↔`jobId`); a name-only match carries `confidence: "label-only"` |
| `interview_sessions` | screening | `occurredAt = started_at ?? created_at` |
| `decision_records` | screening | the hash-chained seal store, now also folded into the candidate drawer timeline |
| `consent_events` | screening | GDPR trail |
| `dev_sessions` / `dev_submissions` | case | reached via `pipeline_entries.dev_submission_id` |
| `intake_events` | job-definition | **the one new table** — see below; projected onto the cluster's shared band |

### `intake_events` — the only new write

`role_intakes.transcript_json` is a JSON array rewritten whole on every exchange, so it can say when
the row was last touched but never when a round happened. `intake_events` is append-only, written
through the single chokepoint `recordIntakeEvent`, and carries **two clocks**: `occurred_at` (the
turn's own `at`) and `recorded_at` (when kp wrote the row). Existing intakes were backfilled from
their transcripts, which is exactly why the two clocks are separate columns — a backfilled round
happened months before it was recorded. The backfill records itself in `seed_marks`, never a
`COUNT(*) > 0`.

The table is in the tenancy manifest with a colocated tenancy test, and `eraseIntakeEvents` is its
only DELETE.

## Honesty properties

These are the feature, not decoration:

- **There is no legend.** Every provenance state is carried on the mark itself and in the row's
  accessible name, so a reader identifies an unidentified actor or a generated row without consulting
  a key. A legend that has to be read is a legend that will not be.
- **A row is never a stored sentence.** It is a `kind` + structured `facts` (+ an optional
  `topicCode`), rendered per locale. Storing English would ship English to cs/de/fr readers and make
  a cohort uncountable.
- **"Nothing happened" and "we never recorded this" never render alike.** Three distinct empty
  states, and an absent phase always carries a reason key.
- **Skipped ≠ never reached.** A column that missed a step but went on is dashed; one that ended is a
  block to the foot of the band. Two different facts about the process.
- **`actor: null` is a fact**, not a blank — it means kp does not know who did this.
- **A name-only match is never presented as certain.**
- **Two clocks are never collapsed**, so a report over a past window stays reproducible.

## Keyless behaviour

The board is fully functional with no API keys — it reads stored facts. Topic classification for
conversational rounds degrades to a deterministic keyword classifier (`intake-topics.ts`) that
returns a code or none and never throws; an unclassified round is a legitimate row and renders
through its kind.

## Known gaps

- **Backfilled intake rounds are unclassified.** The backfill lives in `core.ts` and importing the
  classifier there would add modules to ~207 routes while the perf budget is already red, so
  recovered rounds land with `topic_code` NULL. The registered runner can sweep them later; the
  recipe is at `core.ts:3186-3200`.
- **`JourneyOrigin` cannot be fully derived.** kp persists no test-run marker on `pipeline_entries`.
  A column reads `test-run` only when it has interview sessions and all are `mode='test'`, so a test
  entry that never reached an interview is indistinguishable from live traffic.
- **11 pipeline event kinds are unmapped** in `render-keys.ts` (`interview_scorecard`,
  `intake_degraded`, `rematched`, `outreach_sent`, `group_eval`, …) and render through
  `events.unknown`, which names the raw kind rather than rendering blank.
- **`case_evaluated` is deliberately not emitted**: `dev_submissions` stores no instant for the
  evaluation, and borrowing `received_at` would claim it happened at submission time.
- **A shared job-definition row has no `entryId`**, so it gets the fact card but no source button.
- **`railCellState` exists twice** — once server-side in `project.ts` and once in the board's
  `railCells.ts`. That is deliberate for now: `project.ts` reaches the database and a client
  component must not import it. The clean fix is to extract the pure rail logic into a shared
  dependency-free module both import.
- **A row's sentence clamps to two lines.** This reverses the board's original "never truncate" rule
  and is what took visible rows from 5 to 12 on a 1000px screen. The full sentence stays in the DOM as
  the row button's accessible name and is printed unclamped in the fact card, one click away.
- **The rail's machine-share is no longer a visual channel.** With the bar removed in favour of the
  `n/n` number, `journey.rail.byMachine` survives only in the step's accessible name; a sighted reader
  reads the same fact per event from the actor glyph.
- **Minimap labels truncate on narrow spans.** Spans are proportional to column count, so a role with
  3 of 50 journeys gets a few dozen pixels. The full name is the jump button's accessible name.
- No arrow-key roving between rows; every row is a native button, so a deep column is a long tab.
