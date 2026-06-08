# Feature Scout Fix Wave 16 — Med/Low sweep, batch 2 (PREP5, PIPE4)

> 2 commits on `main`. DEC5 reordered later (see below).
> Baseline preserved: tsc 0 → 0 · unit 638 → 638 · python 490 → 490 · next build ✓.

## Commits

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `5b3fc9a` | **PREP5** — assign an interviewer to a round | `interview-prep.ts`, `api/interview-prep/route.ts`, `InterviewPrepModal.tsx`, `ScheduleTab.tsx` |
| 2 | `f31a436` | **PIPE4** — per-stage aging SLAs | `PipelineTypes.ts`, `PipelineTab.tsx`, `PipelineShared.tsx` |

## What was shipped

- **PREP5** — interviewer assignment. No notion of *who* runs a round. An
  "Interviewer" field in the prep modal persists on the prep artifact via the SAME
  debounced PUT as the checklist/notes (one write path → no race; cleared on
  regenerate like the other human inputs). `listPreparedEntries` now returns
  `{ createdAt, interviewer }`, so the schedule card shows a "👤 <name>" line —
  ownership at a glance for a multi-interviewer team. The card's prepared-state fetch
  already re-runs on prep-modal close, so a new assignment appears immediately.
- **PIPE4** — per-stage aging SLAs. The board aged every candidate on one flat
  `STALE_DAYS` (10). Adds stage-appropriate defaults (Accepted 14 / Screened 7 /
  Interview 5 / Offer 3; Hired never ages) via `slaForStage()`, driving `isStale` +
  the aging quick-filter. An "Aging SLAs" editor overrides the thresholds per board
  (localStorage, no schema — mirrors PIPE5). Aging labels drop the meaningless single
  number; the per-card tooltip names the stage's real threshold. The server-side
  `sla_breach` automation event is deferred (needs the policy pass) — board cue only.

## Verification

| Gate | Baseline | After Wave 16 |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 638 | 638 |
| `npm run test:python` | 490 (4 skip) | 490 (4 skip) |

## Order correction — DEC5 reordered later

On reading DEC5 in full it's heavier than first rated: per-role config **keying**
(`screening:<roleKey>` in decision-config-store) **plus** a new **auto-advance**
automation branch in `runScreenWave` (symmetric to auto-reject) + schema + Rules-modal
UI — effectively a DEC1/DEC2-sized feature, not a sweep item. Moved toward the end of
the sweep (or its own focused pass), and PIPE4 was pulled forward.

## Med/Low order — progress

Done: dedup-by-email ✅, PIPE5 ✅, MAT5 ✅, PREP5 ✅, PIPE4 ✅. Remaining (revised):
**all-tabs PDF → VOX5 → JOB5 → VOX4 → DEC6 → DEC5 (heavier) → PREP4 (large) → SCH4
(delicate)**. Heavyweight VOX2 skipped.

## Branch / merge note

Committed on `main` (post-merge). `main` now 55 commits ahead of `origin/main`,
unpushed. Pre-existing idea-batch WIP untouched.
