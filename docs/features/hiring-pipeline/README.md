# Hiring pipeline (Settings → Hiring)

The workspace's hiring-pipeline composer — the **"Matrix" control board**
(winner of the /prototype round, 2026-08-10).

## Entry point

`/?tab=hiring` — the "Hiring" item in the Settings nav group (`tabs.ts`,
appended last; chunk in `tabChunks.ts`; glyph `GitBranch` in `navMeta.ts`).
Feature dir: `app/features/settings/hiring/`.

## What it does

Composes how candidates move from application to offer: one row per station
(Screening / Round 1..n / Offer, up to `INTERVIEW_PLAN_MAX_ROUNDS = 3`
interview rounds), columns for mode (AI or human round), approval gating
(human approves vs auto) and the cohort reducer between rounds (top-N).
Quick-apply org-complexity presets (Solo-lean / Team-hybrid / Enterprise-
governance) sit above the table. The **impact strip** (`PlanImpactStrip`)
derives, live, what the composed plan does to the Hiring tabs: the Overview
funnel stations, the human queues appearing in Decisions (with a
decisions-per-hire count), and which Schedule surfaces (AI-round docket /
calendar + self-scheduling) are in play.

## The preview previews the REAL board

`deriveImpact().overview` used to emit its own station vocabulary — `screened →
ai_interview → human_interview → offer → hired` — under a panel headed
"Overview". The actual Overview renders `Accepted → Screened → Interview → Offer
→ Hired`. Three mismatches at once: the entry column was missing, the AI/human
interview split had no columns behind it, and the labels came from
`hiringPlan.impact.ov*` while the board's headers come from `enums.stage.*`.
Whatever that panel was showing, it was not a preview — and it is the main
reason Settings and Overview read as two unrelated products.

It now walks `DEFAULT_STAGE_AXIS` (`app/_lib/pipeline-stages.ts` — the same
literal the board reads) and returns one `PlanOverviewStation` per real column,
annotated with the rounds the plan runs there. The strip renders those with
`enumLabel("stage", …)`, so the chips and the board headers are the same strings
in every locale. The composer's fixed station rows are labelled from the axis
too (`COMPOSER_STATIONS`), so "Screened" and "Offer" name columns you can go and
look at.

**One round is not one column, yet.** The shipped default plan runs *two* rounds
(AI, then human) across the *one* `Interview` column — that is what the hybrid
handoff does at runtime: it queues a human round without moving the candidate off
Interview. Rounds therefore bind to interview stages left-to-right and any
surplus **stacks on the last one**, which the preview states (`Interview AI →
Human`) instead of drawing a column that does not exist. Making rounds and
interview stages 1:1 is the job of the per-workspace-axis phase.

Pinned by `pipelineComposerModel.test.ts`: every preset's preview must equal the
real axis, no phantom columns, and the composer's fixed rows must point at stages
that exist.

## Pipeline steps — the board's columns, editable

`PipelineStepsEditor.tsx` is the half of this tab that used to not exist. Until
it landed, Settings → Hiring could compose *policy* (who approves what) but not
the funnel: the five board columns were a compile-time literal, identical for
every workspace forever.

Each row is one board column: **label** (free text), **role**, the stored **id**
(read-only), reorder, remove. Add appends before the terminal column.

Two rules earn their keep:

- **Role is an explicit control, not a hidden attribute.** Every product rule
  resolves through it — the fairness gate, the move menu's terminal exclusion,
  org benchmarks — so leaving it implicit would mean guessing, and guessing wrong
  silently changes what "advanced past screening" measures.
- **The id is shown beside a saved step.** It is the value stored on every
  candidate and every history row; a recruiter renaming a column should be able
  to see that the underlying key does not move. Ids are minted once, at add time
  (`mintStageId` — NFKD + ASCII fold, uniquified), and never change.

The draft model is pure and unit-tested
(`app/features/shared/pipelineAxisDraft.ts` / `.test.ts` — it moved into
`shared/` when the first-run wizard's **Pipeline** step became a second editor of
the same axis; the problem sentences and role names moved with it, into
`shared/usePipelineAxisCopy.ts`, so the two surfaces cannot tell an operator
different things about the same rule): add / remove / rename / reorder, plus
`axisProblems`, which mirrors
the server's `validatePipelineStages` so a recruiter is not told "invalid" after
rearranging six columns. The test runs both over the same cases to keep them
honest. It is deliberately *stricter* in one place: duplicate LABELS are refused
client-side (legal on the wire, since ids are what must be unique, but two
columns both reading "Interview" cannot be told apart on the board).

**Removal is not deletion.** A saved step that leaves the draft becomes a
`retired` tombstone, so history and a stranded candidate can still be given its
name. A step the draft only *added* just disappears — it was never stored.

### Nobody gets stranded silently

Removing a column is the one settings change that can leave real people off the
board. `GET /api/pipeline/stage-impact` (operator-gated, its own route so the
board's 30s poll does not pay for a `GROUP BY`) reports per-stage occupancy;
`strandedByDraft` reports which *saved* columns the draft drops *with candidates
on them*. An empty column is not warned about — that removal is free, and
warning about it would train the reader to dismiss the warning that matters.

Save is **blocked** until every stranded step has a destination. The prompt is a
select per removed step, offering only steps that **survive this edit** — mapping
onto another column the same edit removes would move candidates out of one hole
into another. It is also blocked if the occupancy read failed and the draft
removes anything: a missing count must never make a removal look safe.

### The migration itself

`POST /api/pipeline/stage-migration` applies the axis change **and** the moves it
forces, as one request — the two are one decision ("remove this column, send its
people there"), and splitting them across two calls would let a client perform
half.

The server does **not** take the client's word for who is stranded: it recomputes
occupancy and returns `409 migration_required` (naming each unmapped step and its
count) if anything is unaccounted for. The composer's disabled Save button is a
courtesy; this is the guarantee. A destination that is not on the *new* axis is a
`400 invalid_mapping`.

**The wizard writes here too.** The first-run **Pipeline** step
(`app/features/shell/setup/`) posts to this same route at `finish()`, with an empty
`migrate` map — it refuses to remove an occupied column at all, since a modal has
nowhere to ask where those candidates should go, and it points at this composer
instead. It also writes **only when the axis actually changed**: accepting the
shipped columns is a legitimate answer, and a needless POST would promote the
default to a team-scoped override and silently detach the workspace from a later
org-baseline change.

**Ordering, and why.** Candidates move FIRST, the axis is written SECOND. The two
live behind separate SQLite connections (the decision-config store opens its own),
so a single transaction cannot span them — and the order decides what a failure
between them looks like:

| | outcome of a failure between the halves |
|---|---|
| moves → axis (**chosen**) | candidates already moved to a column that still exists. Odd-looking, fully recoverable, nobody lost. |
| axis → moves | candidates on a column the board no longer draws. The exact stranding this phase exists to eliminate. |

The moves themselves *are* atomic with their audit events —
`migratePipelineStages` runs one IMMEDIATE transaction — so the partial state
above is the only one reachable, and it is benign.

**Every moved candidate gets an event.** `stage_migrated` (its own kind, not
`moved`: nobody chose to advance *this* candidate, and a recruiter reading the
trail three weeks later needs to know that) carrying from/to. Terminal
(`rejected` / `declined`) rows are never touched — they are not on the board, so
removing their column strands nobody, and moving them would rewrite closed
history.

Covered by `app/_lib/db/pipeline-stage-migration.test.ts` (the transaction) and
`app/api/pipeline/stage-migration/stage-migration-route.test.ts` (the refusals).

## Persistence — save-gated by design

Edits accumulate as a local **draft**; nothing is stored until **Save plan** —
a stray preset click can never silently override the live policy. Dirty state
is structural (`planEqualsStored`), **Discard changes** restores the last
saved plan, and Save adopts the server's validated/normalized config back into
the draft.

The tab holds **two coordinated drafts** (`useHiringComposer.ts`): the axis and
the plan. Both read the same draft axis, so renaming a column updates the policy
rows and the preview as you type — the two tables are visibly one pipeline, which
is the point of the whole synchronization pass. Save writes the **axis first**,
then the plan: the plan's stations resolve against the axis
(`composerStations`), so persisting a plan that references a column the stored
axis does not have yet would leave a window where the two disagree. Only the
phase that actually changed is written.

Storage: the `"interviewPlan"` phase of the tiered decision-config store
(`decision-config-schema.ts` owns the wire shape `InterviewPlanRule` +
validation — human rounds are force-gated human, round 1 carries no reducer,
`topN` clamps to 1–50; `decision-config-store.ts` persists it; the existing
operator-gated `/api/decisions/config` route reads/writes it, team-override
tier). No new table — the tenancy manifest is untouched.

## Lib surface

`pipelineComposerModel.ts` — pure, unit-tested (`pipelineComposerModel.test.ts`):
`PipelinePlan`/`PlanRound` (UI shape with list-key ids), `PRESETS`,
`deriveImpact()`, `matchesPreset()`, and the wire conversions
`toStoredPlan()` / `fromStoredPlan()` / `planEqualsStored()`.

## Enforcement (what the plan drives today)

- **Hybrid handoff** (`pipeline-entry-action.ts`): accepting an AI round's
  scorecard, when the plan runs a HUMAN round after it
  (`planRoutesAiScorecardToHumanRound`), routes the candidate back to the
  calendar gate (human-round scheduling) instead of advancing toward Offer —
  stage stays Interview, a `human_round_queued` event lands on the timeline,
  and the decision seals with `policyVersion: "interview-plan"` +
  `inputs.handoff`. A HUMAN-conducted scorecard (`approvalDetail.source ===
  "human"`) always advances as before. The Decisions queue narrates the
  handoff through the same "queued on Schedule" banner as an accepted
  screening.
- **Schedule surfaces** (`ScheduleTab.tsx`): the Human/AI round switcher is
  plan-aware — only the rounds the plan runs are offered (single-surface plans
  render that surface with no switcher), the plan's FIRST round is the default
  view (never overriding a manual switch), and a human-only plan hides the
  "Start AI interview" launcher on pending cards. Server read:
  `app/_lib/interview-plan.ts` (`getInterviewPlan`); pure helpers
  (`planHasRound`, `planRoutesAiScorecardToHumanRound`) in
  `decision-config-schema.ts`.

- **Auto screening gate** (`automation-run.ts`, screen task):
  `screeningGate: "auto"` ratifies a parked screening review UNATTENDED when
  the AI's recommendation is **advance** (i.e. it parked only for confidence)
  — through the same accept machinery a recruiter's click uses (advance +
  calendar gate, `auto_advanced` event, sealed with actor
  `auto:interview-plan`), CAS-guarded on the just-set approval. **hold and
  reject recommendations always park** — auto mode never overrides a cautious
  or adverse verdict, preserving the fairness posture. `"human"` (default) is
  today's behavior byte-identical.
- **Auto offer gate** (`automation-run.ts`, offer task): `offerGate: "auto"`
  extends a freshly-drafted offer unattended via the shared
  `extendDraftedOffer` path (idempotent open-offer reuse, truthful sent/queued
  dispatch, sealed `offer_terms` with the machine as actor, `applied:
  "offer_sent"` + an `offer_auto_extended` event). Hard guards: an UNPRICED
  fail-safe draft always parks for a human to price; an extend failure parks
  the draft at `offer_review` as if the gate were human.

## Known gaps

- The top-N cohort reducer is advisory (the Decisions cards' peer rank shows
  the standing); it does not auto-cut the cohort.
- Multi-round sequencing beyond one AI round needs a per-entry round pointer;
  today the handoff anchors on the plan's first AI round.
- Saving writes the team tier only; there is no org-baseline editor UI yet
  (the store supports it).
