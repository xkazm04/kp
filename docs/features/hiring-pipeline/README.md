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

## Known gaps

- The plan is stored and previewed but **not yet enforced**: the pipeline
  action layer, Schedule's round switcher and the Decisions queues do not read
  it yet. The enforcement design (plan-aware routing on accept, hybrid cohort
  reducer as a sealed decision, onboarding step) lives in
  `docs/concepts/interview-rounds.md`.
- Saving writes the team tier only; there is no org-baseline editor UI yet
  (the store supports it).
