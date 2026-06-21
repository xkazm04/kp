---
name: pipeline-advance
promotion: discovery
surfaces: [Pipeline tab, "Pipeline Board & Candidate Drawer"]
characters: [petra-recruiter, marek-coordinator]
language: cs
---

# Posun kandidátů pipeline a kandidátská zásuvka

## Goal (in the user's words)
"Chci přetáhnout kandidáta o fázi dál, otevřít jeho zásuvku a vidět CELOU jeho
historii na jednom místě, a poslat ho na pohovor / k nabídce — bez toho, že se mi
něco tiše ztratí."

## Definition of done (user POV)
- Drag / advance moves a candidate across stages and the move sticks (no silent revert).
- The candidate **drawer** opens with a **unified timeline** (analysis → screening →
  comms → schedule → offer events in one place), not scattered fragments.
- Advancing to interview/offer is one obvious action; nothing about the candidate's
  state is silently lost on navigation/refresh.

## Entry state / preconditions
- Dev gate on → workspace at `/`, Pipeline tab (the default landing tab,
  `app/features/tabs.ts:81`).
- A seeded pipeline with candidates spread across stages (`seed_pipeline.py`).

## What L1 must check (structural, code-grounded)
- **Surface model:** the board + drawer in `app/features/sub_pipeline/PipelineBoard.tsx`
  and `CandidateDrawer.tsx`; the candidate result view `CandidateResultView.tsx`; live
  updates via `/api/pipeline/events/route.ts` (SSE). Reachable for both (no role gating).
- **Move integrity:** drag → `actOnPipelineEntry` with `expectedStage` + `actor:"human"`
  (see the command path `app/api/pipeline/command/route.ts:78-80`, which reuses the SAME
  guarded action the board uses — `route.ts:46`). Confirm the stage guard prevents a
  stale-tab move from clobbering a concurrent change (optimistic-concurrency check).
- **Unified timeline (central):** the drawer pulls `/api/pipeline/[id]/timeline` →
  `app/_lib/candidate-timeline.ts`. Audit that it MERGES the real cross-surface events
  (analysis, decision, outreach/comms, schedule, offer) into one ordered feed — a drawer
  that only shows stage changes is a `missing` finding against "no silent state loss".
- **NL command bar (Marek):** `/api/pipeline/command/route.ts:61` previews
  (`reject_below`/`advance_top`) before mutating and executes only with `confirm:true` —
  a preview/undo affordance; confirm it's not a new privilege (same guarded action).
- **Reachability:** the board needs seeded entries; an empty board is an empty-state
  finding, not a pass. Token links for sub-flows surface via `TokenLink.tsx`.

## What L2 must confirm (live-only)
- l2_priority: drag a candidate one stage forward, **refresh**, and confirm the move
  persisted; then drag back and confirm the timeline records both moves (no silent loss).
- Open the drawer on a candidate with history and assert the timeline is **unified +
  chronological** across surfaces — spot-check that a scheduled interview and a prior
  analysis BOTH appear.
- Live update: trigger a change and confirm the board reflects it via the SSE stream
  (`/api/pipeline/events`) without a manual reload.
- Advance to interview/offer and confirm the next-step affordance (mint schedule
  invite / generate offer) is reachable from the drawer — the hand-off to
  `interview-schedule-prep.md` / offers isn't a dead-end.

## Out of scope / known
- Minting the self-scheduling invite + prep pack → `interview-schedule-prep.md`.
- Generating/sending the offer + onboarding next step → offers scope.
- The comparative group pick that decides WHO advances → `group-eval-fairness.md`.
