# Hiring pipeline (Settings → Hiring)

The workspace's hiring-pipeline composer — one step matrix plus three impact
previews, rendered from the composition kit (`app/_components/kit/`; promoted at
Gate 1 of the kit-unification spark, 2026-09). The earlier "Matrix" control board
(the /prototype winner of 2026-08-10) is what the kit view re-sets on the measure.

## Entry point

`/?tab=hiring` — the "Hiring" item in the Settings nav group (`tabs.ts`,
appended last; chunk in `tabChunks.ts`; glyph `GitBranch` in `navMeta.ts`).
Feature dir: `app/features/settings/hiring/`. `HiringTab.tsx` renders
`kit/HiringKitView.tsx`; the state and IO are `useHiringComposer.ts`, the rules
that read them `composerState.ts`, the plan model `pipelineComposerModel.ts`, and
the kit view's own data-to-rows reading `kit/hiringKitModel.ts` (pinned by
`kit/hiringKitModel.test.ts`).

### Layout (composition kit)

- **Page head** (`kit/HiringKitHead.tsx`): eyebrow, title, intro; three figures
  (steps of 12, human decisions, rounds to book), each with its change against the
  STORED plan; the one primary **Save plan**, with a quiet "All changes saved."
  beside it while nothing is unsaved. The presets sit under it as a segmented
  control.
- **Pipeline steps** (`kit/HiringKitMatrix.tsx`, the kit `FlowTable`): ONE row per
  board column. The name is the field (the stored key rides its tip; a draft-only
  step says *New*), its quiet line says the type, who stands there now and a legacy
  stack ("2 rounds here", with the row's mark turned to caution); type (the app's
  `Select`) and the AI-actions button sit in the meta track, the cohort in meta+1,
  the executor and the guard in the figure and time tracks, reorder and remove in
  the act track. The row mark's SHAPE says who decides there (a person, the machine
  unattended, nothing). The section's state line says when the plan was stored, or
  **"Never saved: the product defaults apply"** when neither half ever was
  (`versions` from `/api/decisions/config`). At a sheet of 1000px or less (1280
  beside the shell) only the cohort column folds; it reappears in the row's detail
  line.
- **Stranded candidates** (`kit/HiringKitStranded.tsx`): a caution section with a
  destination per removed column; see *Nobody gets stranded silently*.
- **Save bar**: exists only while a draft is unsaved, IN FLOW under the matrix, so
  it never covers a row; it says why a save is refused before it says "unsaved".
- **Impact previews** (`kit/HiringKitPreviews.tsx`): see *How the impact previews
  are drawn*.

## What it does

Composes how candidates move from application to offer in **one table**: a row per
board column, carrying both the column itself (type, name, order) and the policy
that runs there — mode (AI or human round), approval gating (human approves vs
auto) and the cohort reducer into each round (top-N, any integer 1–50; the
composer Select leads with 2/3/5/8 then the rest of the range), up to
`INTERVIEW_PLAN_MAX_ROUNDS = 3` rounds across the whole plan. Quick-apply
org-complexity presets (Solo-lean / Team-hybrid / Enterprise-governance) sit above
it.

### Presets: Enterprise rewrites the COLUMNS, not just the policy

A preset is an intent bound to the board (`preset()` in `pipelineComposerModel.ts`).
Lean and Hybrid keep whatever columns the workspace has and set only the gates and
rounds. **Enterprise carries an `axis` builder as well**, because the funnel it
describes needs columns the shipped five do not have — different functionality is
bound to each name, so the axis has to say so:

```
Accepted → Homework → AI interview → Screened → Human interview → Offer → Hired
 entry     homework    interview     screening    interview        offer   terminal
```

The case precedes the AI round on purpose: the round's questions are grounded in
the marked homework, and `Screened` is the **human triage after** that round rather
than a pre-interview read.

Mechanics worth knowing before changing it:

- It is an **edit of the loaded axis**, never a fresh board. Columns are reused by
  role, so every stored id (`Accepted`, `Screened`, `Interview`, `Offer`, `Hired`)
  survives and only `Homework` / `Human interview` are minted — from fixed ASCII
  seeds, so the stored key does not differ per locale. Labels come in localized
  from `hiringPlan.presetAxis.*`; the model has no translator and must not write
  English onto a Czech board.
- Columns the target funnel has no place for **are dropped** — that is the rewrite.
  Nobody is stranded by it: the preset only edits the DRAFT, and the host's existing
  refusal (`useHiringComposer` → `composerState.deriveComposerState`) blocks Save
  until each dropped column with occupants has a destination, shipping the moves in
  the same `/api/pipeline/stage-migration` request as the axis write.
- The plan is built against the **new** axis (`p.plan(next.stages)`), so a round can
  never be keyed to a column the same click removed.
- `matchesPreset()` compares the axis's role signature when a preset declares one
  (`axisRoles`). Without it, Enterprise clipped onto five columns yields the same
  policy as Team hybrid, and both would light up; `activePresetId()` therefore checks
  presets in reverse declaration order, most specific first.

It was two tables until the plan became stage-keyed: this one, and a Station /
Mode / Approval / Cohort matrix (`PipelineComposerMatrix`, deleted) that listed
the same columns again in its own order with its own words, so the recruiter had
to hold "row 3 there is row 2 here" in their head. A row-per-column editor needs
one policy per column, which the role-keyed shape could not give it. The **impact previews**
derive, live, what the composed plan does to the Hiring tabs: the Overview
funnel stations, the human queues appearing in Decisions (with a
decisions-per-hire count), and which Schedule surfaces (AI-round docket /
calendar + self-scheduling) are in play.

### How the impact previews are drawn

`kit/HiringKitPreviews.tsx` draws three panes in one strip on the measure, each a
miniature of the tab it predicts in that tab's own grammar, with the kit's rules,
marks, tags and figures (token CSS in `kit/hiringKitPreviews.css`, loaded with the
tab's chunk). `impact/impactShared.tsx` keeps the two readings they share,
`useImpactCopy()` (station labels through `enums.stage.*`) and `gateLedger()`. At a
sheet of 1000px or less the board takes its own line.

| Pane | Drawn as |
| --- | --- |
| Overview | a miniature of the board: ruled columns in board order, `enums.stage.*` headers, round tags, the board's own `·` in a column the plan runs nothing at, and the live occupancy under each station (`occupancyMark`: omit while the fetch is in flight) |
| Decisions | a checkpoint ladder over `gateLedger()`, each gate's mark shaped by who decides it, with the human-decisions figure |
| Schedule | a representative week grid (labelled as one), the rounds-to-book figure, and tags naming the live channels |

**The ladder shows the gates you turned OFF.** `PlanImpact.decisions` lists only
the HUMAN queues, so any reading built on it alone is blind to an `auto` gate —
the recruiter could not see what they had just switched off. `gateLedger()`
(`impact/impactShared.tsx`) instead returns EVERY point where a verdict could be
ratified — screening, each round, offer — with the mode that governs it, and the
pane marks the auto ones with the machine shape. It applies the same rule
`deriveImpact()` does: a HUMAN round's verdict is human by definition, so the
gate only governs AI rounds.

The block placement in the week grid is a representative week, not a forecast,
and is labelled as one (`impact.weekAria`); the legend under the grid carries the
load-bearing claim about which surfaces are actually in play.

**Every card previews the plan AS THE SERVER WILL READ IT.** The composer is the
only reader in the product that holds the plan *raw*: it loads
`/api/decisions/config` (`getAllDecisionConfigs`), while every server consumer
goes through `getInterviewPlan`, which `prunePlanToAxis`-es first. So the blob the
editor holds can name a column this axis does not draw (the draft just removed
it; an org-baseline plan was authored against a different axis) or one that
cannot hold policy at all (a column re-roled to entry/terminal). `deriveImpact()`,
`roundCount(plan, axis)` and `gateLedger()` therefore all run the SAME
`prunePlanToAxis` the runtime does, rather than re-deriving which columns count.

Before that, the three cards could contradict each other from one plan: removing
the only interview column left Overview correctly showing the board running
nothing while Schedule still promised an AI docket and "1 round to book", off a
step the very next server read discards.

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

**The plan is stage-keyed.** Every gate and every round names the board column it
governs (`InterviewPlanStep.stageId`). It did not always: the wire shape used to
be `screeningGate` + a flat `rounds` array + `offerGate`, which said nothing about
*which* column anything ran at, and two defects followed —

- rounds bound to interview columns left-to-right with any **surplus stacking
  implicitly on the last one**. The shipped default relies on this (two rounds,
  one `Interview` column: the hybrid handoff queues a human round without moving
  the candidate off Interview). The binding lived in a derivation, so nothing
  could state it and nothing could edit it.
- the gates were keyed by **role**, not column — one `screeningGate` per
  workspace. But the axis model only forces entry, terminal and offer to be
  unique (`UNIQUE_ROLES`): screening and interview columns may repeat, so a
  second screening column silently shared the first one's gate.

Both are fixed in the data now. `migrateLegacyInterviewPlan(legacy, axis)`
converts a pre-migration blob by reproducing exactly what the old runtime did —
the screening gate goes to every screening column, the offer gate to the offer
column, rounds bind left-to-right with the surplus still landing on the last
interview column — so a migration cannot change what a workspace's hiring
already does. Rounds with no interview column to land at are **dropped**, which
is what the board already showed. Reads go through `getInterviewPlan`, which
`prunePlanToAxis`-es against the workspace's real axis (a column dropped since
the last save takes its policy with it); nothing is rewritten on disk until the
composer next saves.

**One round is still not one column.** The stage-keyed shape lets a workspace put
each round at its own column, but the shipped default still stacks two at
`Interview` — now explicitly, as `steps[].rounds.length === 2`, rather than by a
rule hidden in a derivation. That is what unblocks merging the steps editor and
the policy matrix into one row-per-step table.

Pinned by `pipelineComposerModel.test.ts` (32 checks): every preset's preview must
equal the real axis, no phantom columns, the composer's fixed rows must point at
stages that exist — and, for the stage-keyed shape, that the legacy default lands
both rounds on the one `Interview` column, that a two-interview-column axis takes
one round each, that **two screening columns get two independently settable
gates**, that rounds with nowhere to run are dropped rather than invented, that
the validator refuses two policies for one column, that the round cap counts the
whole plan rather than one column, and that only the plan's very first round is
exempt from the cohort reducer.

**The UI model is the wire model.** `PipelinePlan` is an alias of
`InterviewPlanRule`, not a translation of it: the `fromStoredPlan` /
`toStoredPlan` projection is gone, along with the minted round ids it existed to
add and strip. It was only ever a bridge from when the wire shape was role-keyed
too, and a projection could only ever lose what the merged editor was built to
express (two screening columns with different gates). Nothing is converted on load
or save, so there is no second model to keep in step.

**One step, one activity.** An interview column runs exactly ONE round. Rounds used
to stack — two conversations behind one column, added with an *Add interview round*
button that quietly created configuration the board could not draw. They are steps
now: to run an AI round, then scoring, then a human panel, the operator adds three
steps and picks their types. That is the same gesture the rest of the table already
uses, and it produces a board a candidate can actually be standing on. The
add-round button is gone with the stacking; **`scoring` is a stage role**
(`pipeline-stages.ts`), so the automated pass between the two interviews is a
column like any other — nameable, reorderable, removable.

A plan saved *before* that rule can still hold a stacked column. The editor renders
its first round and shows an amber "{n} rounds here" chip naming the fix, and
leaves the data alone: silently dropping a round would change who gets interviewed.

Three decision cells per row — **cohort · executor · guard** — each on its own
track of the matrix (`policyRows` in `kit/hiringKitModel.ts`, drawn by
`kit/HiringKitCells.tsx`), so one dimension reads straight down the table. What
fills them is decided by the column's TYPE, never its position:

| Type | Cohort | Executor | Guard |
| --- | --- | --- | --- |
| entry, terminal | — | — | — (arrival and outcome are not decisions) |
| screening | — | AI, stated | who signs the screen off |
| homework | — | AI, stated (it writes the case and marks it) | who approves **sending** it |
| interview | who reaches this round | AI or a person | who ratifies the verdict |
| scoring | — | AI, stated | who signs the score off |
| offer | — | AI drafts it, stated | who sends it |
| custom | — | — | — (the automation layer resolves policy by role, so a guard here would be a switch wired to nothing) |

Each decision is ONE button showing its current value, flipping on click, with a
kit tip that says both the state and what a click does; a decision the type fixes
is stated as quiet text whose tip carries the sentence ("Screening is always done
by AI. What you choose is who signs it off."). A cohort is offered only
where it means something — the plan's first round has no previous cohort to reduce,
which is what the validator enforces — and its slot is reserved even then, so rows
stay in a grid.

## Pipeline steps — the board's columns, editable

The matrix's step half (`kit/HiringKitMatrix.tsx`) is the part of this tab that used to not exist. Until
it landed, Settings → Hiring could compose *policy* (who approves what) but not
the funnel: the five board columns were a compile-time literal, identical for
every workspace forever.

Each row is one board column: **label** (the name field), **type** (the role
picker), the stored **id** (the name field's tip), reorder, remove. Add appends
before the terminal column.

The first-run wizard's Pipeline step edits the same axis with its own row,
`app/features/shared/PipelineStepRow.tsx` (bound through
`SetupPipelineStageRow.tsx`); the Settings matrix no longer shares it. In the wizard
the type comes **before** the name: the type is
the closed vocabulary every product rule resolves through, and it is what makes a
free-text name legible ("Tech screen" says nothing until you know it is an
*Interview*). It is also the only fixed-width cell, so a column of pickers lines
up down the list while the name field is the one thing that flexes. What the two
callers pass in rather than fork: the assignable role set, whether a row's type is
stated instead of offered (the wizard pins entry and terminal), what rides in the
meta slot (this editor's stored id / *new* badge; the wizard's occupancy count),
and every accessible name.

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

### Which AI actions each step offers

The AI-actions button on each matrix row (it opens the row's detail line of action chips) says which AI actions a
recruiter can run from the candidate modal on someone standing in that step — Screen,
Prep, Scorecard, Draft offer, Outreach, Rejection, Explore alternatives. Until someone
picks otherwise a step offers **our default for its type** (screening steps screen,
interview rounds prep and score, the offer step drafts the offer, rejection and
alternatives before the outcome, outreach everywhere). A **homework** step is the
one type defined by what it does *not* offer: outreach, rejection and alternatives
only. `Screen` is withheld because a screen run there would advance the candidate
past the assignment the column exists to give them (`screeningStageIds` excludes
homework columns even though they are pre-gate), and `Prep` because there is nothing
to prep from until the case comes back. Each default action's chip tips
"Default", and the button's tip says whether the step follows the default or a custom list.

A selection is stored on the stage as `actions` in the same `pipelineStages` config the
columns live in (`setStageActions` in `pipelineAxisDraft.ts`, saved with the columns),
and only when it differs from the default: a selection that equals the default — or
**Reset to default** — stores nothing, so the step follows a later change to the
default. An empty selection is a real answer: nothing runs there. The validator refuses
unknown or repeated actions and stores the list in canonical order. The rule itself, and
the server's refusal of an action a step does not offer, are documented with the
candidate modal in [`../pipeline/README.md`](../pipeline/README.md#the-candidate-modal).

### Aging thresholds follow the role, not the name

The board's amber "aging" dot, the `?quick=aging` filter, the header's Aging
chip, the sidebar's Pipeline badge and the automation pass's feed alerts all read
one aging clock, `agingTier(stage, daysInStage, axis, overrides)`
(`app/_lib/aging-policy.ts`: `none` / `aging` past the SLA / `stalled` past twice
it), over one threshold function, `slaForStage(stage, overrides, axis)`
(`app/features/shared/pipelineTypes.ts`). The pass receives the tier per entry,
resolved on that entry's own workspace axis, so a composed column alerts in the
activity feed at the same moment it turns amber on the board (see
[`../pipeline/README.md`](../pipeline/README.md), policy pass).
The default is keyed by the **role** a column plays on this workspace's axis
(`ROLE_SLA_DEFAULTS`: entry 14 d, screening 7 d, homework 7 d, interview 5 d, scoring 5 d,
offer 3 d, terminal never, `custom` the flat legacy 10 d), so a composed
"Tech round" ages like an interview instead of falling through to the flat
cut, and a renamed column keeps its threshold. Resolution order: the
recruiter's per-column override (the board's "Aging SLAs" editor, localStorage,
keyed by column id) → the role default → the shipped default for a retired
canonical id that still has candidates standing on it → the flat cut for an id
nothing knows. The SLA editor lists the axis's non-terminal columns under
their workspace labels, placeholder = the default that is already firing. The
shipped five are byte-identical to before (`STAGE_SLA_DEFAULTS` is now derived
from the role table). The sidebar badge is computed server-side from the
defaults only — a recruiter's local overrides are a per-browser concern it
approximates.

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
removes anything: a missing count must never make a removal look safe — and it
**says so**. A failed occupancy read paints its own line above the editor
(`hiringPlan.occupancyUnknown`) with a **retry**, and the save bar names *that*
reason rather than "fix the problems above", which used to appear over a page
with no problems on it. The three refusal reasons are one value, not one boolean:
`blockedReason` ∈ `problems` | `unmapped` | `occupancy` (`composerState.ts`).

### Two savers, one plan

Both writes are **preconditioned on the version the client read**. `GET
/api/decisions/config` returns `versions` beside `configs` — per phase, the
effective row's `updated_at`, resolved through the same cascade as the config
itself (team override, else org baseline, else `null` for "nothing stored"). The
composer echoes that token as `expectedUpdatedAt` on every write; the store
re-asserts it inside an **IMMEDIATE** transaction and throws
`DecisionConfigStaleError` if it moved, which the routes answer as **409**
`DECISION_CONFIG_STALE` (rules) / `PIPELINE_AXIS_STALE` (axis, refused *before*
anybody is moved). The tab then shows a standing banner with **Reload the saved
plan**, which drops the local drafts and adopts what is stored — merging a draft
onto a pipeline whose columns may no longer exist is exactly the lost update
this closes. The token is opt-in: a writer with no read behind it (the first-run
wizard composes the axis from nothing) omits the field. Versions are strictly
increasing, so two saves inside one millisecond are still distinguishable.
Pinned by `app/_lib/decision-config-version.test.ts` (5 checks).

**Both write doors are rate-limited** per IP, after every cheap refusal:
`decisions/config` at 60/10min (`CONFIG_RATE_LIMIT`) and `pipeline/stage-migration`
at 20/10min (`MIGRATION_RATE_LIMIT`) — the latter moves real candidates. Operator
gating is not the bound: open mode makes it a documented no-op for the whole API.
Both are pinned in `app/api/rate-limit-contract.test.ts`.

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

**A failed post-save re-read is not a failed save.** Save re-reads the config
and the occupancy afterwards; those two reads used to sit inside the same `try` as
the writes, unguarded, so a 500 on either toasted "Couldn't save the plan" over
two committed writes and invited a second save. `runComposerSave` separates them:
the writes report `saved`, and a failed refresh gets its own line
(`hiringPlan.refreshFailed`) with a retry.

The state composition itself — dirty, blocked and *why*, the migration legs a save
needs, what a discard restores, and what a save attempt actually did — is pure and
unit-tested in `composerState.ts` / `composerState.test.ts` (10 checks).

The tab holds **two coordinated drafts** (`useHiringComposer.ts`): the axis and
the plan. Both read the same draft axis, so renaming a column updates the policy
rows and the preview as you type — the two tables are visibly one pipeline, which
is the point of the whole synchronization pass. Save writes the **axis first**,
then the plan: the plan's stations resolve against the axis
(`composerStations`), so persisting a plan that references a column the stored
axis does not have yet would leave a window where the two disagree. Only the
phase that actually changed is written.

**The plan is sent in BOARD order** (`sortPlanToAxis`, applied in `save()` against
the *draft* axis). The wire shape is order-sensitive in exactly one place: the
validator numbers rounds by their position in `steps` to decide which is the
plan's FIRST — the one with no previous cohort to reduce, whose `topN` it nulls.
The editor, meanwhile, appends a column's step on first touch and never reorders,
so a step added and then moved earlier leaves the array disagreeing with the
board. Without the sort, a "Top 3" the composer legitimately offered on the
board's *second* interview round was stripped by a save that reported success.
`prunePlanToAxis` sorts on READ, which hides the divergence from every consumer
and from nobody at all on the way in. Steps for columns the axis does not draw
sort LAST: they are pruned on the next read, so letting one hold position 0 would
hand the no-reducer exemption to a round that is about to vanish.

**Shipped default (behaviour change).** The default plan is human-reviewed
screening, ONE gated AI round, human-approved offers. It used to be two rounds (AI,
then human for the top 3) stacked behind the single `Interview` column. The hybrid
handoff (`planRoutesAiScorecardToHumanRound`) needs a human round after an AI one,
so **it no longer fires by default**. A workspace that has ever saved its hiring
plan is untouched — defaults apply only where nothing was chosen — and a workspace
that wants the handoff adds an Interview step and sets its executor to a person,
which is a visible decision instead of an invisible one. Presets follow the same
rule: they CLIP to the interview columns the board has rather than doubling rounds
up behind the last one.

Storage: the `"interviewPlan"` phase of the tiered decision-config store
(`decision-config-schema.ts` owns the wire shape `InterviewPlanRule` +
validation — human rounds are force-gated human, the plan's first round carries
no reducer, `topN` clamps to 1–50, a duplicate `stageId` is refused, and the
3-round cap counts the whole plan; `decision-config-store.ts` persists it; the
existing operator-gated `/api/decisions/config` route reads/writes it,
team-override tier). No new table — the tenancy manifest is untouched, and the
stage-keyed migration needs **no DB migration**: the validator accepts both wire
shapes and converts a legacy blob on read, so stored plans keep working
untouched until their next save.

## Lib surface

`pipelineComposerModel.ts` — pure, unit-tested (`pipelineComposerModel.test.ts`):
`PipelinePlan`/`PlanRound` (aliases of the wire shape — there is no projection),
`PRESETS`, the editing helpers `setStepGate()` / `setStepRounds()` /
`patchRound()`, the axis-scoped readings `deriveImpact()` / `roundCount()`, the
save-time normalizer `sortPlanToAxis()`, and the comparisons `planEqualsStored()`
/ `matchesPreset()`.

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
  `getPlanGateForRole("screening")` `=== "auto"` ratifies a parked screening
  review UNATTENDED when
  the AI's recommendation is **advance** (i.e. it parked only for confidence)
  — through the same accept machinery a recruiter's click uses (advance +
  calendar gate, `auto_advanced` event, sealed with actor
  `auto:interview-plan`), CAS-guarded on the just-set approval. **hold and
  reject recommendations always park** — auto mode never overrides a cautious
  or adverse verdict, preserving the fairness posture. `"human"` (default) is
  today's behavior byte-identical.
- **Auto offer gate** (`automation-run.ts`, offer task):
  `getPlanGateForRole("offer") === "auto"`
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
