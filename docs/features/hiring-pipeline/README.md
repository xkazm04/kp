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

## Persistence — save-gated by design

Edits accumulate as a local **draft**; nothing is stored until **Save plan** —
a stray preset click can never silently override the live policy. Dirty state
is structural (`planEqualsStored`), **Discard changes** restores the last
saved plan, and Save adopts the server's validated/normalized config back into
the draft.

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
